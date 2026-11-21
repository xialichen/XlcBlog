import { createRemoteJWKSet, jwtVerify } from 'jose';
import { CommentError, field, identifier, input, json, page, pageCursor } from './http.js';

const issuers = new Map();
export async function verifyOwner(request, env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD || !env.OWNER_EMAIL)
    throw new CommentError(503, '站主登录尚未配置。');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new CommentError(403, '请通过站主登录入口访问。');
  const issuer = env.ACCESS_ISSUER.replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))
    throw new CommentError(503, '站主登录配置无效。');
  if (!issuers.has(issuer)) issuers.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')));
  try {
    const { payload } = await jwtVerify(token, issuers.get(issuer), {
      algorithms: ['RS256'], issuer, audience: env.ACCESS_AUD, requiredClaims: ['exp', 'email'],
    });
    if (typeof payload.email === 'string' && payload.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase()) return;
  } catch { /* 所有管理请求都必须取得可验证的 Access 身份。 */ }
  throw new CommentError(403, '此账户没有评论管理权限。');
}

const filters = {
  tasks: "(c.state='pending' OR EXISTS(SELECT 1 FROM feedback f WHERE f.comment_id=c.id AND f.resolved_at IS NULL))",
  published: "c.state='published'",
  hidden: "c.state='hidden'",
};

async function adminList(db, url) {
  const filter = url.searchParams.get('filter') || 'tasks';
  if (!Object.hasOwn(filters, filter)) throw new CommentError(400, '分类无效。');
  const [time, cursor] = pageCursor(url.searchParams.get('before'));
  const { results } = await db.prepare(`
    SELECT c.id,c.article,c.title,c.state,c.nickname,c.body,c.created_at,c.reply,c.replied_at,
      (SELECT COUNT(*) FROM feedback f WHERE f.comment_id=c.id AND f.resolved_at IS NULL) AS reports
    FROM comments c WHERE ${filters[filter]} AND (c.created_at,c.id)<(?,?)
    ORDER BY c.created_at DESC,c.id DESC LIMIT 21
  `).bind(time, cursor).all();
  return json(page(results));
}

export async function adminApi(context, path) {
  const { request, env } = context, db = env.COMMENTS_DB;
  if (!path && request.method === 'GET') return adminList(db, new URL(request.url));
  const [rawId, action, extra] = path.split('/');
  const id = identifier(rawId);
  if (extra || !action) throw new CommentError(404, '接口不存在。');
  if (action === 'feedback' && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const [time, cursor] = pageCursor(params.get('before'));
    const { results } = await db.prepare(`SELECT id,reason,detail,created_at FROM feedback
      WHERE comment_id=? AND resolved_at IS NULL AND (created_at,id)<(?,?)
      ORDER BY created_at DESC,id DESC LIMIT 21`).bind(id, time, cursor).all();
    return json(page(results));
  }
  if (request.method !== 'POST') throw new CommentError(405, '请求方式不支持。');
  const data = await input(request), now = Date.now();
  const resolve = db.prepare('UPDATE feedback SET resolved_at=? WHERE comment_id=? AND resolved_at IS NULL').bind(now, id);
  let result;
  switch (action) {
    case 'publish':
      result = await db.prepare("UPDATE comments SET state='published' WHERE id=? AND state='pending'").bind(id).run();
      break;
    case 'hide':
      [result] = await db.batch([db.prepare(`UPDATE comments SET before_hide=state,state='hidden',hidden_at=?
        WHERE id=? AND state IN ('published','pending')`).bind(now, id), resolve]);
      break;
    case 'restore':
      result = await db.prepare(`UPDATE comments SET state=before_hide,before_hide=NULL,hidden_at=NULL
        WHERE id=? AND state='hidden' AND hidden_at>?`).bind(id, now - 30 * 86_400_000).run();
      break;
    case 'resolve':
      result = await resolve.run();
      break;
    case 'reply':
      result = await db.prepare("UPDATE comments SET reply=?,replied_at=? WHERE id=? AND state='published'")
        .bind(field(data.body, '回复', 2000), now, id).run();
      break;
    default: throw new CommentError(404, '操作不存在。');
  }
  if (!result.meta.changes) throw new CommentError(409, '留言状态已变化，请刷新列表。');
  return json({ ok: true });
}
