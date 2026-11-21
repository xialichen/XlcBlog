export class CommentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

export async function handle(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CommentError) return json({ error: error.message }, error.status);
    console.error('Comment service error', error.name);
    return json({ error: '评论服务暂时不可用，请稍后重试。' }, 503);
  }
}

export async function input(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    throw new CommentError(403, '请从本站页面提交。');
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new CommentError(415, '提交格式无效。');
  const reader = request.body?.getReader();
  if (!reader) throw new CommentError(400, '提交内容为空。');
  const decoder = new TextDecoder();
  let size = 0, raw = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 24_576) {
      await reader.cancel();
      throw new CommentError(413, '提交内容过长。');
    }
    raw += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(raw + decoder.decode());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new CommentError(400, '提交格式无效。'); }
}

export function field(value, label, max, optional = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !result) || (value != null && typeof value !== 'string') || result.length > max)
    throw new CommentError(400, label + '格式或长度不符合要求。');
  return result;
}

export function identifier(value) {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value))
    throw new CommentError(400, '留言编号无效。');
  return value;
}

export function pageCursor(value) {
  if (!value) return [Number.MAX_SAFE_INTEGER, ''];
  const [time, id] = value.split('.');
  if (!/^\d{1,15}$/.test(time) || value !== time + '.' + id) throw new CommentError(400, '分页参数无效。');
  return [Number(time), identifier(id)];
}

export function page(rows) {
  const items = rows.slice(0, 20);
  const last = items.at(-1);
  return { items, next: rows.length > 20 ? last.created_at + '.' + last.id : null };
}

const encode = new TextEncoder();
function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', encode.encode(value)));
}

export async function ownerHash(request, article, required = false) {
  const key = request.headers.get('X-Comment-Key');
  if (!key && !required) return '';
  if (!key || !/^[\da-f]{64}$/.test(key)) throw new CommentError(400, '浏览器撤回凭证无效。');
  return digest('owner/' + article + '/' + key);
}

export async function limit(request, env, action, maximum) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !env.COMMENT_RATE_SECRET) throw new CommentError(503, '防刷服务暂时不可用。');
  const size = 10 * 60_000, bucket = Math.floor(Date.now() / size);
  const secret = await crypto.subtle.importKey('raw', encode.encode(env.COMMENT_RATE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const key = hex(await crypto.subtle.sign('HMAC', secret, encode.encode([action, bucket, ip].join('/'))));
  const row = await env.COMMENTS_DB.prepare(`
    INSERT INTO comment_limits(key,hits,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits=hits+1 WHERE hits < ? RETURNING hits
  `).bind(key, (bucket + 1) * size, maximum).first();
  if (!row) throw new CommentError(429, '提交过于频繁，请稍后再试。');
}

export async function verifyHuman(request, env, token, action) {
  if (!env.TURNSTILE_SECRET || !env.COMMENT_HOSTS) throw new CommentError(503, '人机验证暂时不可用。');
  if (typeof token !== 'string' || !token || token.length > 2048)
    throw new CommentError(400, '请完成人机验证后重试。');
  const host = new URL(request.url).hostname;
  if (!env.COMMENT_HOSTS.split(',').map(s => s.trim()).includes(host))
    throw new CommentError(403, '请在博客正式地址或指定预览地址提交。');
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
  });
  if (!response.ok) throw new CommentError(503, '验证服务暂时不可用，请重试。');
  const result = await response.json();
  if (result.success !== true || result.action !== action || result.hostname !== host)
    throw new CommentError(403, '人机验证已失效，请重新验证。');
}
