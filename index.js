/**
 * 人民日报 PDF 存档 —— Host 半部。
 *
 * 负责真正的抓取、下载、合并与归档（见 lib/engine.js），并把同一份任务状态
 * 同时暴露给两个消费者：
 *   - Web 面板：同源 HTTP 接口 /rmrb/api/*（lib/routes.js）
 *   - 智能体：工具 rmrb_archive（lib/tool.js）
 */
import os from 'node:os';
import path from 'node:path';
import { createJobStore } from './lib/jobs.js';
import { createApiHandler, API_ROUTE } from './lib/routes.js';
import { createArchiveTool } from './lib/tool.js';

/** Web 载体的 Host 服务；线程内没有它就说明这个组合没有网页。 */
export const inject = ['webServer'];

/**
 * 默认落盘位置：用户文档目录下的「人民日报存档」。
 *
 * 面板是应用级入口、没有会话绑定，所以不用某个会话的工作目录；用户在面板或
 * 工具参数里随时可以改成绝对路径。
 */
export function defaultOutputDir() {
  const documents = path.join(os.homedir(), 'Documents');
  return path.join(documents, '人民日报存档');
}

export function apply(ctx) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('rmrb-archive') : undefined;
  const store = createJobStore({ defaultOutputDir, logger });

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: API_ROUTE,
      handler: createApiHandler({ ctx, store }),
    });
    return () => {
      dispose();
      store.dispose();
    };
  }, 'rmrb-archive: http api');

  ctx.inject(['tools'], (scoped) => {
    scoped.effect(() => scoped.tools.register(createArchiveTool(store)), 'rmrb-archive: agent tool');
  });
}
