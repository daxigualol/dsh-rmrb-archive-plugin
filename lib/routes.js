/**
 * 面板使用的 HTTP 接口。
 *
 * 这些路由和网页同源，因此面板里可以直接 fetch。授权交给 Connection：
 * `requestRejection()` 执行 Host/Origin 检查与浏览器凭据校验，对远程的、
 * 未认证的请求返回 401/403；它不存在时（例如没有 Web 载体的组合）按本地
 * 同源处理。
 */
/** 注册用的前缀路由：结尾不能带斜杠，前缀匹配按 `<path>/` 展开。 */
export const API_ROUTE = '/rmrb/api';
/** 处理请求时从前缀之后截取动作名。 */
export const API_PREFIX = `${API_ROUTE}/`;

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

function methodNotAllowed(res, allowed) {
  res.setHeader('allow', allowed);
  sendJson(res, 405, { ok: false, message: `仅支持 ${allowed}` });
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象');
    return parsed;
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

/**
 * @param {{ ctx: any, store: ReturnType<import('./jobs.js').createJobStore> }} options
 */
export function createApiHandler({ ctx, store }) {
  return async function handler(req, res) {
    const connection = ctx.get('connection');
    const rejection = connection?.requestRejection?.(req);
    if (rejection !== undefined) {
      res.statusCode = rejection;
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(String(req.url), 'http://localhost');
    } catch {
      sendJson(res, 400, { ok: false, message: '无法解析请求地址' });
      return;
    }
    const action = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '');

    try {
      if (action === 'state') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          methodNotAllowed(res, 'GET');
          return;
        }
        const since = Number(url.searchParams.get('since'));
        sendJson(res, 200, { ok: true, ...store.snapshot(Number.isFinite(since) ? since : 0) });
        return;
      }

      if (action === 'defaults') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          methodNotAllowed(res, 'GET');
          return;
        }
        sendJson(res, 200, { ok: true, ...store.defaults() });
        return;
      }

      if (action === 'start' || action === 'cancel') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, 'POST');
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '')
          .split(';', 1)[0]
          .trim()
          .toLowerCase();
        if (contentType !== 'application/json') {
          sendJson(res, 415, { ok: false, message: 'content-type 必须是 application/json' });
          return;
        }
        const body = await readJsonBody(req);
        if (action === 'cancel') {
          const outcome = store.cancel();
          sendJson(res, outcome.cancelled ? 200 : 409, { ok: outcome.cancelled, message: outcome.cancelled ? '已请求停止' : outcome.reason, jobId: outcome.jobId });
          return;
        }
        const started = store.start(body);
        sendJson(res, 200, { ok: true, message: '任务已启动', ...started });
        return;
      }

      sendJson(res, 404, { ok: false, message: `未知接口：${action || '/'}` });
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 400;
      sendJson(res, status, { ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  };
}
