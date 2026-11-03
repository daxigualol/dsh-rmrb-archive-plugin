/**
 * 单任务存档作业仓库：面板和智能体工具共用同一份任务状态。
 *
 * 规则：
 *   - 同一时间只允许一个任务（站点是公共资源，避免并发抓取）。
 *   - 任务在后台运行，启动请求立即返回，面板轮询 state 读取进度。
 *   - 日志用递增 seq 标记，客户端带上 since 只取增量。
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { eachDate, MAX_RANGE_DAYS, runArchive } from './engine.js';

const LOG_LIMIT = 400;

function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 校验并补全启动参数。面板和工具都经过这里，保证两条入口语义一致。
 * @param {Record<string, unknown>} input
 * @param {{ defaultOutputDir: string, baseDir: string }} context
 */
export function normalizeParams(input, context) {
  if (input === null || typeof input !== 'object') throw new Error('参数必须是对象');
  const record = /** @type {Record<string, unknown>} */ (input);
  const startDate = typeof record.startDate === 'string' ? record.startDate.trim() : '';
  const endDate = typeof record.endDate === 'string' && record.endDate.trim() !== '' ? record.endDate.trim() : startDate;
  const dates = eachDate(startDate, endDate);

  const rawOutput = typeof record.outputDir === 'string' ? record.outputDir.trim() : '';
  const outputDir =
    rawOutput === ''
      ? context.defaultOutputDir
      : path.isAbsolute(rawOutput)
        ? path.normalize(rawOutput)
        : path.resolve(context.baseDir, rawOutput);

  const params = {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    outputDir,
    merge: asBoolean(record.merge, true),
    groupByMonth: asBoolean(record.groupByMonth, true),
    validateEditions: asBoolean(record.validateEditions, true),
    cleanup: asBoolean(record.cleanup, true),
    collectMissing: asBoolean(record.collectMissing, true),
    notice: asBoolean(record.notice, true),
    concurrency: 4,
    downloadConcurrency: 3,
    timeoutMs: 30000,
    downloadTimeoutMs: 120000,
    delayMs: 1200,
  };

  if (typeof record.delayMs === 'number' && Number.isFinite(record.delayMs)) {
    params.delayMs = Math.max(0, Math.min(10000, Math.round(record.delayMs)));
  }
  return { params, days: dates.length };
}

function publicResult(result) {
  return {
    date: result.date,
    ok: result.ok === true,
    pages: result.pages ?? 0,
    downloaded: result.downloaded ?? 0,
    missing: result.missing ?? [],
    error: result.error ?? null,
    grouped: result.grouped ?? null,
  };
}

function summarize(job) {
  const results = job.results;
  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;
  return {
    days: job.progress.dayTotal,
    finished: results.length,
    ok,
    failed,
    missingDays: results.filter((result) => result.ok && result.missing.length > 0).length,
    outputDir: job.params.outputDir,
    noticePath: job.noticePath ?? null,
  };
}

function publicJob(job) {
  if (job === null) return null;
  return {
    id: job.id,
    status: job.status,
    params: job.params,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    results: job.results.map(publicResult),
    summary: job.summary,
    error: job.error,
    cancelRequested: job.cancelRequested,
  };
}

/**
 * @param {{ defaultOutputDir: () => string, logger?: { warn: (message: string) => void } }} options
 */
export function createJobStore(options) {
  /** @type {null | Record<string, any>} */
  let job = null;
  let jobSeq = 0;

  function appendLog(target, level, text) {
    jobSeq += 1;
    target.log.push({ seq: jobSeq, level, text, t: Date.now() });
    if (target.log.length > LOG_LIMIT) target.log.splice(0, target.log.length - LOG_LIMIT);
    target.lastSeq = jobSeq;
  }

  function snapshot(since) {
    if (job === null) return { job: null, log: [], logLast: jobSeq };
    const cursor = Number.isFinite(since) && since >= 0 && since <= job.lastSeq ? since : 0;
    return {
      job: publicJob(job),
      log: cursor === 0 ? job.log.slice() : job.log.filter((entry) => entry.seq > cursor),
      logLast: job.lastSeq,
    };
  }

  function defaults() {
    return {
      today: localIsoDate(),
      outputDir: options.defaultOutputDir(),
      maxRangeDays: MAX_RANGE_DAYS,
    };
  }

  function start(input) {
    if (job !== null && job.status === 'running') throw new Error('已有任务在运行，请先停止或等待完成');
    const baseDir = path.dirname(options.defaultOutputDir());
    const { params, days } = normalizeParams(input, { defaultOutputDir: options.defaultOutputDir(), baseDir });

    const controller = new AbortController();
    /** @type {Record<string, any>} */
    const record = {
      id: randomUUID().slice(0, 8),
      status: 'running',
      params,
      startedAt: Date.now(),
      finishedAt: null,
      lastSeq: jobSeq,
      log: [],
      results: [],
      summary: null,
      error: null,
      cancelRequested: false,
      noticePath: null,
      controller,
      progress: {
        phase: 'fetching',
        dayIndex: 0,
        dayTotal: days,
        date: params.startDate,
        editionDone: 0,
        editionTotal: 0,
        title: null,
      },
    };
    job = record;
    record.summary = summarize(record);
    appendLog(record, 'info', `开始 ${params.startDate} → ${params.endDate}（${days} 天），输出目录：${params.outputDir}`);

    const onLog = (level, text) => {
      appendLog(record, level, text);
    };

    runArchive(params, {
      signal: controller.signal,
      onLog,
      onDayStart: ({ date, index, total }) => {
        record.progress = {
          phase: 'day',
          dayIndex: index + 1,
          dayTotal: total,
          date,
          editionDone: 0,
          editionTotal: 0,
          title: null,
        };
      },
      onProgress: (progress) => {
        record.progress = {
          ...record.progress,
          editionDone: progress.editionDone,
          editionTotal: progress.editionTotal,
          title: progress.title ?? null,
        };
      },
      onDayEnd: (result) => {
        record.results.push(publicResult(result));
        record.summary = summarize(record);
      },
    })
      .then((outcome) => {
        record.noticePath = outcome.noticePath;
        record.status = controller.signal.aborted ? 'cancelled' : 'done';
        record.progress = { ...record.progress, phase: record.status, title: null };
        record.summary = summarize(record);
        appendLog(
          record,
          record.status === 'cancelled' ? 'warn' : 'info',
          record.status === 'cancelled' ? '任务已停止' : '任务完成',
        );
      })
      .catch((error) => {
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
        record.progress = { ...record.progress, phase: 'failed', title: null };
        record.summary = summarize(record);
        appendLog(record, 'error', `任务失败：${record.error}`);
        options.logger?.warn?.(`人民日报存档任务失败：${record.error}`);
      })
      .finally(() => {
        record.finishedAt = Date.now();
      });

    return { jobId: record.id, params, days };
  }

  function cancel() {
    if (job === null || job.status !== 'running') return { cancelled: false, reason: '没有正在运行的任务' };
    job.cancelRequested = true;
    appendLog(job, 'warn', '正在停止…');
    job.controller?.abort();
    return { cancelled: true, jobId: job.id };
  }

  function dispose() {
    job?.controller?.abort();
  }

  return { start, cancel, snapshot, defaults, dispose };
}
