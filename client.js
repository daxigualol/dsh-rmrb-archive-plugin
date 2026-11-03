/**
 * 人民日报 PDF 存档 —— Client 半部。
 *
 * 注册两个插槽：
 *   - sidebar.panellist（id: rmrb-archive）：左侧栏入口图标 + 标签
 *   - main（key: rmrb-archive）：点击入口后显示的面板页
 *
 * 面板不直接抓取站点：浏览器跨域拿不到 paper.people.com.cn 的 PDF，实际
 * 下载由 Host 半部完成，这里通过同源接口 /rmrb/api/* 启动、轮询、停止任务。
 */
window.__ModuleLoader__.load({
  id: '@daxigualol/rmrb-archive',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const NS = 'rmrb';
    const API = '/rmrb/api';

    /* ------------------------------- 词典 ------------------------------- */

    const zh = {
      'panel.label': '人民日报',
      'page.title': '人民日报 PDF 存档',
      'page.subtitle': '按日期从 paper.people.com.cn 下载《人民日报》各版 PDF，合并为每日一份并归档。',
      'form.start': '开始日期',
      'form.end': '结束日期',
      'form.output': '保存目录',
      'form.copy': '复制路径',
      'form.today': '今天',
      'form.hint': '下载在后台进行，可以随时离开此页；任务状态由本机后台继续推进。',
      'option.merge': '合并为每日单份 PDF',
      'option.groupByMonth': '按月份整理（YYYYMM/YYYYMMDD.pdf）',
      'option.validate': '校验版次并记录缺失',
      'option.cleanup': '版次完整时删除分版 PDF',
      'action.start': '开始下载',
      'action.stop': '停止',
      'action.starting': '启动中…',
      'status.idle': '未开始',
      'status.running': '进行中',
      'status.done': '已完成',
      'status.failed': '失败',
      'status.cancelled': '已停止',
      'progress.idle': '等待任务',
      'progress.day': '第 {index}/{total} 天 · {date}',
      'progress.editions': '版次 {done}/{total}',
      'log.empty': '还没有日志。',
      'results.date': '日期',
      'results.status': '结果',
      'results.downloaded': '已下载',
      'results.missing': '缺失版次',
      'results.error': '错误',
      'result.ok': '成功',
      'result.failed': '失败',
      'result.missingNone': '无',
      'notice.started': '任务已启动，日志会实时刷新。',
      'notice.cancelled': '已请求停止。',
      'notice.copied': '路径已复制。',
      'notice.copiedFailed': '复制失败，请手动选择路径。',
      'error.request': '请求失败：{message}',
      'error.dates': '请填写开始日期和结束日期。',
      'footer.local': '该接口只对本机同源的页面开放。',
    };

    const en = {
      'panel.label': "People's Daily",
      'page.title': "People's Daily PDF archive",
      'page.subtitle':
        'Download each edition of the People\u2019s Daily from paper.people.com.cn for a date range, merge them into one PDF per day, and archive the result.',
      'form.start': 'Start date',
      'form.end': 'End date',
      'form.output': 'Output folder',
      'form.copy': 'Copy path',
      'form.today': 'Today',
      'form.hint': 'The download runs in the background; leaving this page does not stop it.',
      'option.merge': 'Merge each day into one PDF',
      'option.groupByMonth': 'Group by month (YYYYMM/YYYYMMDD.pdf)',
      'option.validate': 'Check editions and record gaps',
      'option.cleanup': 'Delete page PDFs when nothing is missing',
      'action.start': 'Start download',
      'action.stop': 'Stop',
      'action.starting': 'Starting\u2026',
      'status.idle': 'Idle',
      'status.running': 'Running',
      'status.done': 'Finished',
      'status.failed': 'Failed',
      'status.cancelled': 'Stopped',
      'progress.idle': 'Waiting for a job',
      'progress.day': 'Day {index}/{total} \u00b7 {date}',
      'progress.editions': 'Editions {done}/{total}',
      'log.empty': 'No log entries yet.',
      'results.date': 'Date',
      'results.status': 'Result',
      'results.downloaded': 'Downloaded',
      'results.missing': 'Missing editions',
      'results.error': 'Error',
      'result.ok': 'OK',
      'result.failed': 'Failed',
      'result.missingNone': 'none',
      'notice.started': 'Job started; the log refreshes live.',
      'notice.cancelled': 'Stop requested.',
      'notice.copied': 'Path copied.',
      'notice.copiedFailed': 'Copy failed; select the path manually.',
      'error.request': 'Request failed: {message}',
      'error.dates': 'Fill in both the start and the end date.',
      'footer.local': 'This endpoint is only served to same-origin pages on this machine.',
    };

    /* ------------------------------- 样式 ------------------------------- */

    const CSS = `
.rmrb-page{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.rmrb-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.rmrb-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding-top:28px}
[data-platform=darwin] .rmrb-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.rmrb-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.rmrb-sub{margin:6px 0 20px;color:var(--dsw-alias-label-secondary);font-size:13px;max-width:720px}
.rmrb-pill{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rmrb-pill-running{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rmrb-pill-done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.rmrb-pill-failed{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.rmrb-pill-cancelled{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.rmrb-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:16px;margin-bottom:16px}
.rmrb-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin-bottom:12px}
.rmrb-field{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1 1 180px}
.rmrb-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.rmrb-input{height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;min-width:0}
.rmrb-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.rmrb-input:disabled{opacity:.6}
.rmrb-checks{display:flex;flex-wrap:wrap;gap:8px 20px;margin:4px 0 16px}
.rmrb-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.rmrb-check input{accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;margin:0}
.rmrb-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.rmrb-btn{height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.rmrb-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.rmrb-btn:disabled{opacity:.45;cursor:not-allowed}
.rmrb-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.rmrb-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.rmrb-alert{margin-top:12px;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:13px;word-break:break-word}
.rmrb-notice{margin-top:12px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.rmrb-progress-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.rmrb-bar{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-bottom:12px}
.rmrb-bar-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .25s ease}
.rmrb-log{margin:0;padding:10px 12px;max-height:240px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.rmrb-log-line{display:flex;gap:8px}
.rmrb-log-time{color:var(--dsw-alias-label-secondary);flex:none}
.rmrb-log-warn{color:var(--dsw-alias-state-warn-primary)}
.rmrb-log-error{color:var(--dsw-alias-state-error-primary)}
.rmrb-table{width:100%;border-collapse:collapse;font-size:13px}
.rmrb-table th,.rmrb-table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.rmrb-table th{font-weight:500;color:var(--dsw-alias-label-secondary);font-size:12px}
.rmrb-table tr:last-child td{border-bottom:0}
.rmrb-ok{color:var(--dsw-alias-state-success-primary)}
.rmrb-fail{color:var(--dsw-alias-state-error-primary)}
.rmrb-foot{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rmrb-empty{color:var(--dsw-alias-label-secondary);font-size:13px}
`;

    /* ------------------------------- 组件 ------------------------------- */

    function NewspaperIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', { d: 'M4 5.5h11.5a1 1 0 0 1 1 1V18a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5.5Z' }),
        h('path', { d: 'M16.5 8.5H20v9.5a2 2 0 0 1-2 2' }),
        h('path', { d: 'M7 8.5h5.5M7 11.5h5.5M7 14.5h3.5' }),
      );
    }

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function formatClock(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    }

    function ArchivePage(props) {
      const t = props.t;
      const [form, setForm] = useState({
        startDate: '',
        endDate: '',
        outputDir: '',
        merge: true,
        groupByMonth: true,
        validateEditions: true,
        cleanup: true,
      });
      const [defaults, setDefaults] = useState(null);
      const [job, setJob] = useState(null);
      const [log, setLog] = useState([]);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(false);
      const cursor = useRef(0);
      const jobId = useRef(null);

      const update = useCallback((patch) => {
        setForm((previous) => ({ ...previous, ...patch }));
      }, []);

      /* 首次进入：读取默认日期与默认目录。 */
      useEffect(() => {
        let alive = true;
        fetch(`${API}/defaults`, { headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((data) => {
            if (!alive || !data || data.ok !== true) return;
            setDefaults(data);
            setForm((previous) =>
              previous.startDate === '' && previous.endDate === ''
                ? { ...previous, startDate: data.today, endDate: data.today, outputDir: data.outputDir }
                : { ...previous, outputDir: previous.outputDir === '' ? data.outputDir : previous.outputDir },
            );
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);

      /* 轮询：任务在 Host 端运行，页面只取增量日志。 */
      useEffect(() => {
        let alive = true;
        let timer = null;
        const tick = async () => {
          if (alive && !(typeof document !== 'undefined' && document.hidden)) {
            try {
              const response = await fetch(`${API}/state?since=${cursor.current}`, {
                headers: { accept: 'application/json' },
              });
              const data = await response.json();
              if (!response.ok || data.ok === false) throw new Error(data.message || `HTTP ${response.status}`);
              if (data.job) {
                setJob(data.job);
                if (data.job.id !== jobId.current) {
                  jobId.current = data.job.id;
                  cursor.current = 0;
                  setLog([]);
                } else {
                  if (Array.isArray(data.log) && data.log.length > 0) {
                    setLog((previous) => {
                      const next = previous.concat(data.log);
                      return next.length > 400 ? next.slice(-400) : next;
                    });
                  }
                  if (typeof data.logLast === 'number') cursor.current = data.logLast;
                }
              }
              setError(null);
            } catch (caught) {
              setError(t('error.request', { message: caught instanceof Error ? caught.message : String(caught) }));
            }
          }
          if (alive) timer = setTimeout(tick, 1000);
        };
        tick();
        return () => {
          alive = false;
          if (timer !== null) clearTimeout(timer);
        };
      }, [t]);

      const running = job !== null && job.status === 'running';

      const start = useCallback(async () => {
        if (form.startDate === '' || form.endDate === '') {
          setError(t('error.dates'));
          return;
        }
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
          const response = await fetch(`${API}/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(form),
          });
          const data = await response.json();
          if (!response.ok || data.ok !== true) throw new Error(data.message || `HTTP ${response.status}`);
          setNotice(t('notice.started'));
        } catch (caught) {
          setError(t('error.request', { message: caught instanceof Error ? caught.message : String(caught) }));
        } finally {
          setBusy(false);
        }
      }, [form, t]);

      const stop = useCallback(async () => {
        setBusy(true);
        setNotice(null);
        try {
          const response = await fetch(`${API}/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          const data = await response.json();
          if (data.ok !== true) throw new Error(data.message || `HTTP ${response.status}`);
          setNotice(t('notice.cancelled'));
        } catch (caught) {
          setError(t('error.request', { message: caught instanceof Error ? caught.message : String(caught) }));
        } finally {
          setBusy(false);
        }
      }, [t]);

      const copyPath = useCallback(async () => {
        const value = form.outputDir || job?.params?.outputDir || '';
        try {
          await navigator.clipboard.writeText(value);
          setNotice(t('notice.copied'));
        } catch {
          setNotice(t('notice.copiedFailed'));
        }
      }, [form.outputDir, job, t]);

      const progress = job?.progress ?? null;
      const total = progress?.dayTotal ?? 0;
      const percent =
        job === null || total === 0
          ? 0
          : job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
            ? 100
            : Math.min(100, Math.round((((progress.dayIndex || 1) - 1) + (progress.editionTotal ? progress.editionDone / progress.editionTotal : 0)) / total * 100));

      const statusKey = job === null ? 'status.idle' : `status.${job.status}`;
      const statusText = t(statusKey);
      const progressLabel =
        job === null
          ? t('progress.idle')
          : t('progress.day', { index: progress.dayIndex, total: progress.dayTotal, date: progress.date ?? '' });

      return h(
        'section',
        { className: 'rmrb-page', 'aria-label': t('page.title') },
        h('style', null, CSS),
        h(
          'div',
          { className: 'rmrb-content' },
          h(
            'header',
            { className: 'rmrb-head' },
            h('h1', { className: 'rmrb-title' }, t('page.title')),
            h('span', { className: `rmrb-pill rmrb-pill-${job === null ? 'idle' : job.status}` }, statusText),
          ),
          h('p', { className: 'rmrb-sub' }, t('page.subtitle')),

          h(
            'div',
            { className: 'rmrb-card' },
            h(
              'div',
              { className: 'rmrb-row' },
              h(
                'label',
                { className: 'rmrb-field' },
                h('span', { className: 'rmrb-label' }, t('form.start')),
                h('input', {
                  className: 'rmrb-input',
                  type: 'date',
                  value: form.startDate,
                  disabled: running,
                  onChange: (event) => update({ startDate: event.target.value }),
                }),
              ),
              h(
                'label',
                { className: 'rmrb-field' },
                h('span', { className: 'rmrb-label' }, t('form.end')),
                h('input', {
                  className: 'rmrb-input',
                  type: 'date',
                  value: form.endDate,
                  disabled: running,
                  onChange: (event) => update({ endDate: event.target.value }),
                }),
              ),
            ),
            h(
              'div',
              { className: 'rmrb-row' },
              h(
                'label',
                { className: 'rmrb-field', style: { flex: '1 1 320px' } },
                h('span', { className: 'rmrb-label' }, t('form.output')),
                h('input', {
                  className: 'rmrb-input',
                  type: 'text',
                  value: form.outputDir,
                  disabled: running,
                  spellCheck: false,
                  onChange: (event) => update({ outputDir: event.target.value }),
                }),
              ),
              h('button', { className: 'rmrb-btn', type: 'button', onClick: copyPath }, t('form.copy')),
              h(
                'button',
                {
                  className: 'rmrb-btn',
                  type: 'button',
                  disabled: running || defaults === null,
                  onClick: () => update({ startDate: defaults.today, endDate: defaults.today }),
                },
                t('form.today'),
              ),
            ),
            h(
              'div',
              { className: 'rmrb-checks' },
              h(
                'label',
                { className: 'rmrb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: form.merge,
                  disabled: running,
                  onChange: (event) => update({ merge: event.target.checked }),
                }),
                t('option.merge'),
              ),
              h(
                'label',
                { className: 'rmrb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: form.groupByMonth,
                  disabled: running || !form.merge,
                  onChange: (event) => update({ groupByMonth: event.target.checked }),
                }),
                t('option.groupByMonth'),
              ),
              h(
                'label',
                { className: 'rmrb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: form.validateEditions,
                  disabled: running,
                  onChange: (event) => update({ validateEditions: event.target.checked }),
                }),
                t('option.validate'),
              ),
              h(
                'label',
                { className: 'rmrb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: form.cleanup,
                  disabled: running || !form.validateEditions,
                  onChange: (event) => update({ cleanup: event.target.checked }),
                }),
                t('option.cleanup'),
              ),
            ),
            h(
              'div',
              { className: 'rmrb-actions' },
              h(
                'button',
                { className: 'rmrb-btn rmrb-btn-primary', type: 'button', disabled: running || busy, onClick: start },
                busy && !running ? t('action.starting') : t('action.start'),
              ),
              h('button', { className: 'rmrb-btn', type: 'button', disabled: !running || busy, onClick: stop }, t('action.stop')),
              h('span', { className: 'rmrb-hint' }, t('form.hint')),
            ),
            error === null ? null : h('div', { className: 'rmrb-alert', role: 'alert' }, error),
            notice === null ? null : h('div', { className: 'rmrb-notice' }, notice),
          ),

          job === null
            ? null
            : h(
                'div',
                { className: 'rmrb-card' },
                h(
                  'div',
                  { className: 'rmrb-progress-head' },
                  h('span', null, progressLabel),
                  progress && progress.editionTotal > 0
                    ? h('span', null, t('progress.editions', { done: progress.editionDone, total: progress.editionTotal }))
                    : null,
                  h('span', null, `${percent}%`),
                ),
                h('div', { className: 'rmrb-bar' }, h('div', { className: 'rmrb-bar-fill', style: { width: `${percent}%` } })),
                log.length === 0
                  ? h('p', { className: 'rmrb-empty' }, t('log.empty'))
                  : h(
                      'div',
                      { className: 'rmrb-log', role: 'log', 'aria-live': 'polite' },
                      log.map((entry) =>
                        h(
                          'div',
                          { key: entry.seq, className: 'rmrb-log-line' },
                          h('span', { className: 'rmrb-log-time' }, formatClock(entry.t)),
                          h('span', { className: entry.level === 'error' ? 'rmrb-log-error' : entry.level === 'warn' ? 'rmrb-log-warn' : undefined }, entry.text),
                        ),
                      ),
                    ),
              ),

          job === null || job.results.length === 0
            ? null
            : h(
                'div',
                { className: 'rmrb-card' },
                h(
                  'table',
                  { className: 'rmrb-table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', null, t('results.date')),
                      h('th', null, t('results.status')),
                      h('th', null, t('results.downloaded')),
                      h('th', null, t('results.missing')),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    job.results.map((result) =>
                      h(
                        'tr',
                        { key: result.date },
                        h('td', null, result.date),
                        h(
                          'td',
                          { className: result.ok ? 'rmrb-ok' : 'rmrb-fail' },
                          result.ok ? t('result.ok') : t('result.failed'),
                          result.ok || !result.error ? null : h('div', { className: 'rmrb-empty' }, result.error),
                        ),
                        h('td', null, `${result.downloaded}/${result.pages}`),
                        h('td', null, result.missing.length === 0 ? t('result.missingNone') : result.missing.join('、')),
                      ),
                    ),
                  ),
                ),
                job.summary && job.summary.noticePath
                  ? h('p', { className: 'rmrb-foot' }, job.summary.noticePath)
                  : h('p', { className: 'rmrb-foot' }, job.summary ? job.summary.outputDir : ''),
              ),

          h('p', { className: 'rmrb-foot' }, t('footer.local')),
        ),
      );
    }

    /* ------------------------------ 注册 ------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rmrb-archive: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'rmrb-archive', locale: NS }, ArchivePage),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'rmrb-archive',
              order: 20,
              locale: NS,
              label: () => t('panel.label'),
            },
            NewspaperIcon,
          ),
        );
      },
    };
  },
});
