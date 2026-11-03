/**
 * 人民日报 PDF 存档引擎。
 *
 * 逻辑移植自 renminribao-1.4：
 *   generateLinks.js              -> eachDate() / pageUrlFor()
 *   fetchPageData.js              -> fetchDay()
 *   downloadPDF.js                -> downloadToFile()
 *   mergePDFs.js                  -> mergePdfFiles()
 *   check-folders.js              -> verifyEditons()
 *   rename-and-group-by-month.js  -> groupByMonth()
 *   collect-missing.js            -> collectMissing()
 *   missing_notice.js             -> buildMissingNotice()
 *
 * 与参考实现的差别：
 *   - 不依赖 axios / cheerio / moment / pdf-merger-js；只用 node: 内置模块和
 *     随包内置的 pdf-lib（vendor/pdf-lib.min.cjs）。
 *   - HTML 解析改用正则，仍然读取同样的结构：
 *       <a id="pageLink" href="node_01.html">01版：要闻</a>
 *       <div class="paper-bot"><p class="right btn"><a href="....pdf">PDF下载</a></p></div>
 *       <div class="date-box"><p class="date">人民日报 2025年12月01日 Mon</p></div>
 *   - 每个环节都接受 AbortSignal，面板可以随时停止任务。
 */
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PDF_LIB_PATH = fileURLToPath(new URL('../vendor/pdf-lib.min.cjs', import.meta.url));

/** 站点根路径（与参考实现的 generateLinks.js 一致）。 */
export const SITE_ROOT = 'https://paper.people.com.cn/rmrb';
/** 2024-11-30 及以前使用旧版栏目入口。 */
export const LEGACY_LAST_DATE = '2024-11-30';
/** 单个任务允许的最大日期跨度（防止误填造成长时间抓取）。 */
export const MAX_RANGE_DAYS = 62;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** 把 "2025-12-01" 解析成 UTC 零点，避免时区把日期推前一天。 */
export function parseIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** YYYY-MM-DD 序列（含首尾）。 */
export function eachDate(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (start === null || end === null) throw new Error('日期格式必须是 YYYY-MM-DD');
  if (start > end) throw new Error('开始日期不能晚于结束日期');
  const dates = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (dates.length > MAX_RANGE_DAYS) throw new Error(`日期范围不能超过 ${MAX_RANGE_DAYS} 天`);
  }
  return dates;
}

export function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** 某一天的版面入口地址（对应 generateLinks.js）。 */
export function pageUrlFor(isoDate) {
  const [year, month, day] = isoDate.split('-');
  if (isoDate <= LEGACY_LAST_DATE) return `${SITE_ROOT}/html/${year}-${month}/${day}/nbs.D110000renmrb_01.htm`;
  return `${SITE_ROOT}/pc/layout/${year}${month}/${day}/node_01.html`;
}

function timeoutSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 30000));
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function getText(url, { signal, timeoutMs } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: timeoutSignal(signal, timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

function cleanText(text) {
  return decodeEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attribute(attrs, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const found = pattern.exec(attrs);
  return found === null ? undefined : (found[1] ?? found[2] ?? found[3]);
}

/** 页面上出现的所有版面链接（对应 fetchPageData.js 里的 $('#pageLink')）。 */
export function extractPageLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1];
    if (attribute(attrs, 'id') !== 'pageLink') continue;
    const href = attribute(attrs, 'href');
    if (href === undefined || href === '') continue;
    let url;
    try {
      url = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title: cleanText(match[2]) || '版面', url });
  }
  return links;
}

/** 版面页里的 PDF 下载地址（对应 fetchPageData.js 里的 $('.paper-bot a')）。 */
export function extractPdfUrl(html, baseUrl) {
  const block = /<div[^>]*class\s*=\s*"[^"]*\bpaper-bot\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const scope = block === null ? html : block[1];
  const anchorPattern = /<a\b([^>]*)>/gi;
  let match;
  while ((match = anchorPattern.exec(scope)) !== null) {
    const href = attribute(match[1], 'href');
    if (href === undefined || href === '' || href.startsWith('#') || href.startsWith('javascript')) continue;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      continue;
    }
  }
  return null;
}

/** 版面页里的出版日期（对应 fetchPageData.js 里的 $('.date-box .date')）。 */
export function extractPublishDate(html) {
  const match = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(html);
  if (match === null) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

/** "01版：要闻" -> 1。 */
export function editionOf(title) {
  const match = /^\s*(\d{1,3})/.exec(title) ?? /(\d{1,3})\s*版/.exec(title);
  return match === null ? null : Number(match[1]);
}

/** 版面标题转文件名（同参考实现：只保留字母、数字、汉字）。 */
export function safeFileName(title) {
  const cleaned = String(title).replace(/[^\w\u4e00-\u9fa5]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'page' : cleaned;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 站点偶尔会短暂限流或断连，所以每个请求都重试一次；用户的停止信号优先。
 */
async function withRetry(operation, { attempts = 2, delayMs = 600, signal } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt === attempts) break;
      await sleep(delayMs * attempt, signal);
    }
  }
  throw lastError;
}

/**
 * 抓取某一天的版面清单和各版面 PDF 地址（对应 fetchPageData.js）。
 * 单版失败不会中断整天，失败的版面记为 pdfUrl: null，由后续缺失校验报告。
 */
export async function fetchDay(isoDate, { signal, timeoutMs = 30000, concurrency = 4, onLog } = {}) {
  const entryUrl = pageUrlFor(isoDate);
  const html = await withRetry(() => getText(entryUrl, { signal, timeoutMs }), { signal });
  const publishDate = extractPublishDate(html) ?? isoDate;
  const links = extractPageLinks(html, entryUrl);
  if (links.length === 0) throw new Error(`未找到版面链接：${entryUrl}`);

  const pages = await mapLimit(links, concurrency, async (link) => {
    const edition = editionOf(link.title);
    try {
      const pageHtml = await withRetry(() => getText(link.url, { signal, timeoutMs }), { signal });
      return { ...link, edition, pdfUrl: extractPdfUrl(pageHtml, link.url) };
    } catch (error) {
      onLog?.('warn', `版面页抓取失败 ${link.title}：${error instanceof Error ? error.message : String(error)}`);
      return { ...link, edition, pdfUrl: null };
    }
  });

  return { date: publishDate, entryUrl, pages };
}

/**
 * 下载单个 PDF（对应 downloadPDF.js）：先写 .tmp 再改名，避免留下半截文件。
 */
export async function downloadToFile(url, filePath, { signal, timeoutMs = 60000 } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' },
    redirect: 'follow',
    signal: timeoutSignal(signal, timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('下载内容为空');
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error('下载内容不是 PDF');
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
  return bytes.length;
}

/**
 * 合并 PDF 并写入元数据（对应 mergePDFs.js）。
 */
export async function mergePdfFiles(files, outputPath, metadata = {}) {
  if (files.length === 0) throw new Error('没有可合并的 PDF 文件');
  const { PDFDocument } = require(PDF_LIB_PATH);
  const merged = await PDFDocument.create();
  for (const file of files) {
    const bytes = await readFile(file);
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  merged.setProducer(metadata.producer ?? 'dsh-rmrb-archive');
  merged.setAuthor(metadata.author ?? '人民日报');
  merged.setCreator(metadata.creator ?? 'DSH 人民日报 PDF 存档插件');
  merged.setTitle(metadata.title ?? '人民日报');
  const bytes = await merged.save();
  await writeFile(outputPath, bytes);
  return { path: outputPath, pages: merged.getPageCount(), bytes: bytes.length };
}

/** check-folders.js 的缺失序号算法。 */
export function findMissingEditions(editions) {
  const numbers = [...new Set(editions.filter((value) => Number.isInteger(value)))].sort((left, right) => left - right);
  if (numbers.length === 0) return [];
  const present = new Set(numbers);
  const missing = [];
  for (let value = numbers[0]; value <= numbers[numbers.length - 1]; value += 1) {
    if (!present.has(value)) missing.push(value);
  }
  return missing;
}

async function moveFile(source, destination) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      await copyFile(source, destination);
      await unlink(source);
      return;
    }
    throw error;
  }
}

/**
 * 抓取并归档一天：下载各版面 PDF -> 合并 -> 缺失校验 / 清理分卷。
 * 对应 entrypoint.js 与 check-folders.js。
 */
export async function archiveDay(isoDate, options, hooks = {}) {
  const { outputDir, merge = true, validateEditions = true, cleanup = true } = options;
  const signal = hooks.signal;
  const onLog = hooks.onLog;
  const downloadConcurrency = Math.max(1, Math.min(4, Number(options.downloadConcurrency) || 3));

  const day = await fetchDay(isoDate, {
    signal,
    timeoutMs: options.timeoutMs,
    concurrency: options.concurrency,
    onLog,
  });
  const shortDate = day.date.replace(/-/g, '');
  const dayDir = path.join(outputDir, shortDate);
  await mkdir(dayDir, { recursive: true });

  const wanted = day.pages.filter((page) => page.pdfUrl !== null);
  if (wanted.length === 0) throw new Error('该日所有版面都没有可下载的 PDF');

  let done = 0;
  const downloaded = await mapLimit(wanted, downloadConcurrency, async (page) => {
    const fileName = `${safeFileName(page.title)}.pdf`;
    const filePath = path.join(dayDir, fileName);
    try {
      hooks.onProgress?.({ editionDone: done, editionTotal: wanted.length, title: page.title });
      await withRetry(() => downloadToFile(page.pdfUrl, filePath, { signal, timeoutMs: options.downloadTimeoutMs }), { signal });
      done += 1;
      onLog?.('info', `下载 ${done}/${wanted.length} ${fileName}`);
      return { page, filePath, ok: true };
    } catch (error) {
      onLog?.('warn', `下载失败 ${fileName}：${error instanceof Error ? error.message : String(error)}`);
      return { page, filePath, ok: false };
    }
  });

  const okFiles = downloaded.filter((item) => item.ok).map((item) => item.filePath);
  if (okFiles.length === 0) throw new Error('没有成功下载任何 PDF');

  let mergedPath = null;
  if (merge) {
    mergedPath = path.join(dayDir, 'merged.pdf');
    const result = await mergePdfFiles(okFiles, mergedPath, {
      producer: 'pdf-merger-js script',
      author: '人民日报',
      creator: '人民日报 PDF 合并工具',
      title: `人民日报-${day.date}`,
    });
    onLog?.('info', `合并完成 merged.pdf（${result.pages} 页）`);
  }

  const downloadedEditions = downloaded.filter((item) => item.ok).map((item) => item.page.edition);
  const expectedEditions = day.pages.map((page) => page.edition);
  const missing = validateEditions
    ? findMissingEditions(downloadedEditions).concat(
        [...new Set(expectedEditions)]
          .filter((edition) => Number.isInteger(edition) && !downloadedEditions.includes(edition))
          .sort((left, right) => left - right),
      )
    : [];

  const uniqueMissing = [...new Set(missing)].sort((left, right) => left - right);
  const missingPath = path.join(dayDir, 'missing.txt');
  if (uniqueMissing.length > 0) {
    await writeFile(missingPath, `${uniqueMissing.map((value) => String(value).padStart(2, '0')).join('\n')}\n`, 'utf8');
    onLog?.('warn', `缺失版次：${uniqueMissing.join('、')}（已写入 missing.txt）`);
  } else if (cleanup) {
    const entries = await readdir(dayDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === 'merged.pdf') continue;
      await unlink(path.join(dayDir, entry.name));
    }
    onLog?.('info', '版次完整，已清理分版 PDF');
  }

  return {
    date: day.date,
    folder: dayDir,
    pages: wanted.length,
    downloaded: okFiles.length,
    missing: uniqueMissing,
    mergedPath,
  };
}

/** rename-and-group-by-month.js：把 merged.pdf 移到 <输出目录>/<YYYYMM>/<YYYYMMDD>.pdf。 */
export async function groupByMonth(outputDir, dayResult, onLog) {
  if (dayResult.mergedPath === null) return null;
  const shortDate = dayResult.date.replace(/-/g, '');
  const monthDir = path.join(outputDir, shortDate.slice(0, 6));
  const target = path.join(monthDir, `${shortDate}.pdf`);
  await mkdir(monthDir, { recursive: true });
  await moveFile(dayResult.mergedPath, target);
  try {
    await rmdir(path.dirname(dayResult.mergedPath));
  } catch {
    // 目录里还有 missing.txt 或失败的分卷，保留即可。
  }
  onLog?.('info', `归档 ${path.relative(outputDir, target)}`);
  return target;
}

/** collect-missing.js：把 <YYYYMMDD>/missing.txt 收进 <输出目录>/missing/<YYYYMMDD>.txt。 */
export async function collectMissing(outputDir, onLog) {
  const missingDir = path.join(outputDir, 'missing');
  let created = false;
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{8}$/.test(entry.name)) continue;
    const source = path.join(outputDir, entry.name, 'missing.txt');
    try {
      await mkdir(missingDir, { recursive: true });
      await moveFile(source, path.join(missingDir, `${entry.name}.txt`));
      created = true;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  if (created) onLog?.('info', '缺失清单已收集到 missing/');
  return created ? missingDir : null;
}

/** missing_notice.js：把 missing/*.txt 汇总成一句中文说明。 */
export function buildMissingNotice(entries) {
  if (entries.length === 0) return '未发现任何版次缺失。';
  const items = entries
    .flatMap((entry) => entry.editions.map((edition) => ({ date: entry.date, edition })))
    .sort((left, right) => (left.date === right.date ? left.edition - right.edition : left.date.localeCompare(right.date)));
  const firstYear = Number(items[0].date.slice(0, 4));
  const format = (date, withYear) => {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    return withYear || year !== firstYear ? `${year}年${month}月${day}日` : `${month}月${day}日`;
  };
  const lines = ['本资源已尽量整理完整，个别日期存在版次缺失，具体如下：'];
  const head = items.slice(0, -2);
  const tail = items.slice(-2);
  head.forEach((item, index) => {
    lines.push(`${format(item.date, index === 0)}第${item.edition}版，`);
  });
  if (items.length === 1) {
    lines.push(`${format(items[0].date, true)}第${items[0].edition}版。`);
  } else if (items.length === 2) {
    lines.push(
      `${format(items[0].date, true)}第${items[0].edition}版、${format(items[1].date, false)}第${items[1].edition}版。`,
    );
  } else {
    const [left, right] = tail;
    lines.push(`以及${format(left.date, true)}第${left.edition}版、${format(right.date, false)}第${right.edition}版。`);
  }
  lines.push('');
  lines.push('以上缺失版次均为广告版，不影响新闻正文及主要内容阅读，请放心使用。');
  return lines.join('\n');
}

/** 读取 missing/ 目录下的缺失清单。 */
export async function readMissingEntries(outputDir) {
  const missingDir = path.join(outputDir, 'missing');
  const files = await readdir(missingDir).catch(() => []);
  const entries = [];
  for (const file of files.sort()) {
    const match = /^(\d{8})\.txt$/.exec(file);
    if (match === null) continue;
    const text = await readFile(path.join(missingDir, file), 'utf8');
    const editions = text
      .split(/\r?\n/)
      .map((line) => Number(/(\d+)/.exec(line)?.[1]))
      .filter((value) => Number.isInteger(value));
    if (editions.length > 0) entries.push({ date: match[1], editions });
  }
  return entries;
}

/** 任务级：逐日归档，可选整理、收集缺失清单并生成说明。 */
export async function runArchive(params, hooks = {}) {
  const dates = eachDate(params.startDate, params.endDate);
  const outputDir = params.outputDir;
  await mkdir(outputDir, { recursive: true });
  const delayMs = Math.max(0, Number(params.delayMs) || 0);
  const results = [];
  for (let index = 0; index < dates.length; index += 1) {
    if (hooks.signal?.aborted) break;
    const date = dates[index];
    hooks.onDayStart?.({ date, index, total: dates.length });
    try {
      const day = await archiveDay(date, params, hooks);
      let grouped = null;
      if (params.groupByMonth) grouped = await groupByMonth(outputDir, day, hooks.onLog);
      const result = { ...day, grouped, ok: true, error: null };
      results.push(result);
      hooks.onDayEnd?.(result);
      hooks.onLog?.('info', `${day.date} 完成：${day.downloaded}/${day.pages} 版${day.missing.length > 0 ? `，缺 ${day.missing.join('、')}` : ''}`);
    } catch (error) {
      if (hooks.signal?.aborted) break;
      const message = error instanceof Error ? error.message : String(error);
      const result = { date, folder: null, pages: 0, downloaded: 0, missing: [], mergedPath: null, grouped: null, ok: false, error: message };
      results.push(result);
      hooks.onDayEnd?.(result);
      hooks.onLog?.('error', `${date} 失败：${message}`);
    }
    if (index < dates.length - 1 && delayMs > 0) await sleep(delayMs, hooks.signal);
  }

  let missingDir = null;
  let noticePath = null;
  if (params.collectMissing) missingDir = await collectMissing(outputDir, hooks.onLog);
  if (params.notice) {
    const entries = await readMissingEntries(outputDir);
    if (entries.length > 0) {
      noticePath = path.join(outputDir, '缺失说明.txt');
      await writeFile(noticePath, buildMissingNotice(entries), 'utf8');
      hooks.onLog?.('info', '已生成 缺失说明.txt');
    }
  }

  return { results, outputDir, missingDir, noticePath };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
