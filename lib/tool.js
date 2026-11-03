/**
 * 智能体工具：与面板共用同一个任务仓库，所以模型和用户看到的是同一份进度。
 */

function summaryText(job) {
  if (job === null) return '还没有任何存档任务。';
  const summary = job.summary;
  const lines = [`任务 ${job.id}：${job.status}`];
  if (summary !== null && summary !== undefined) {
    lines.push(`进度 ${summary.finished}/${summary.days} 天：成功 ${summary.ok}，失败 ${summary.failed}，缺版 ${summary.missingDays} 天`);
  }
  const missing = job.results.filter((result) => result.ok && result.missing.length > 0);
  if (missing.length > 0) {
    lines.push(`缺版：${missing.map((result) => `${result.date}(第${result.missing.join('、')}版)`).join('；')}`);
  }
  const failed = job.results.filter((result) => !result.ok);
  if (failed.length > 0) {
    lines.push(`失败：${failed.map((result) => `${result.date} ${result.error ?? ''}`).join('；')}`);
  }
  if (job.error) lines.push(`错误：${job.error}`);
  lines.push(`输出目录：${job.params.outputDir}`);
  return lines.join('\n');
}

export function createArchiveTool(store) {
  return {
    name: 'rmrb_archive',
    description:
      'Download People\'s Daily (人民日报) PDF editions from paper.people.com.cn and merge each day into one PDF. ' +
      'action=start launches a background job for a date range (startDate/endDate as YYYY-MM-DD); action=status reports the latest job, including progress, per-day results and missing editions; action=cancel stops the running job. ' +
      'The same job is shown in the 人民日报 panel of the DSH sidebar. Files are written under outputDir (default: Documents/人民日报存档).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'cancel'],
          description: 'start a download job, report the latest job, or stop the running one.',
        },
        startDate: { type: 'string', description: 'First issue date, YYYY-MM-DD. Required for action=start.' },
        endDate: { type: 'string', description: 'Last issue date, YYYY-MM-DD. Defaults to startDate.' },
        outputDir: {
          type: 'string',
          description: 'Folder to write archives into (absolute, or relative to the default folder). Defaults to Documents/人民日报存档.',
        },
        merge: { type: 'boolean', description: 'Merge each day\'s page PDFs into merged.pdf. Default true.' },
        groupByMonth: { type: 'boolean', description: 'Move merged.pdf into <outputDir>/YYYYMM/YYYYMMDD.pdf. Default true.' },
        cleanup: { type: 'boolean', description: 'Delete page PDFs when a day has no missing edition. Default true.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          jobId: { type: 'string' },
          status: { type: 'string' },
          outputDir: { type: 'string' },
          progress: {
            type: 'object',
            additionalProperties: true,
            properties: {
              dayIndex: { type: 'integer' },
              dayTotal: { type: 'integer' },
              date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              editionDone: { type: 'integer' },
              editionTotal: { type: 'integer' },
            },
          },
          summary: {
            type: 'object',
            additionalProperties: true,
            properties: {
              days: { type: 'integer' },
              finished: { type: 'integer' },
              ok: { type: 'integer' },
              failed: { type: 'integer' },
              missingDays: { type: 'integer' },
            },
          },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                date: { type: 'string' },
                ok: { type: 'boolean' },
                pages: { type: 'integer' },
                downloaded: { type: 'integer' },
                missing: { type: 'array', items: { type: 'integer' } },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
        },
        required: ['ok', 'message'],
      },
      render(_args, value) {
        return [{ type: 'text', text: String(value?.message ?? '') }];
      },
    },
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {};
      const action = typeof input.action === 'string' ? input.action : 'status';
      try {
        if (action === 'start') {
          const started = store.start(input);
          const state = store.snapshot(0);
          return {
            ok: true,
            message: `已开始 ${started.params.startDate} → ${started.params.endDate}（${started.days} 天）的下载，任务 ${started.jobId}。用 action=status 查看进度，或在侧栏“人民日报”面板里查看实时日志。\n输出目录：${started.params.outputDir}`,
            jobId: started.jobId,
            status: 'running',
            outputDir: started.params.outputDir,
            ...(state.job?.progress ? { progress: state.job.progress } : {}),
            ...(state.job?.summary ? { summary: state.job.summary } : {}),
            results: [],
          };
        }
        if (action === 'cancel') {
          const outcome = store.cancel();
          return {
            ok: outcome.cancelled,
            message: outcome.cancelled ? '已请求停止当前任务。' : String(outcome.reason ?? '没有正在运行的任务'),
            ...(typeof outcome.jobId === 'string' ? { jobId: outcome.jobId } : {}),
          };
        }
        const state = store.snapshot(0);
        const job = state.job;
        if (job === null) {
          return { ok: true, message: '还没有任何存档任务。可以先用 action=start 指定 startDate 开始下载。', status: 'idle' };
        }
        return {
          ok: true,
          message: summaryText(job),
          jobId: job.id,
          status: job.status,
          outputDir: job.params.outputDir,
          progress: job.progress,
          summary: job.summary,
          results: job.results,
        };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
