import { CommentError, digest, field, identifier, input, json, limit, ownerHash, page, pageCursor, verifyHuman } from './http.js';

async function articleInfo(context, slug) {
  if (typeof slug !== 'string' || slug.length > 300 || /[\\?#\x00-\x1f]/.test(slug) ||
      slug.split('/').some(s => !s || s === '.' || s === '..'))
    throw new CommentError(404, '这篇文章未开放评论。');
  const path = '/comment-articles/' + slug.split('/').map(encodeURIComponent).join('/') + '.json';
  const response = await context.env.ASSETS.fetch(new URL(path, context.request.url).href);
  if (response.status >= 500) throw new CommentError(503, '文章信息暂时不可用。');
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))
    throw new CommentError(404, '这篇文章未开放评论。');
  const article = await response.json();
  if (article.id !== slug || !article.title) throw new CommentError(404, '这篇文章未开放评论。');
  return article;
}

async function list(context, url) {
  const { env, request } = context;
  const article = await articleInfo(context, url.searchParams.get('post'));
  const owner = await ownerHash(request, article.id);
  const [time, cursor] = pageCursor(url.searchParams.get('before'));
  const { results } = await env.COMMENTS_DB.prepare(`
    SELECT id,nickname,body,state,created_at,reply,replied_at,(owner_hash=?) AS mine
    FROM comments WHERE article=? AND (state='published' OR owner_hash=?)
      AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT 21
  `).bind(owner, article.id, owner, time, cursor).all();
  return json({ ...page(results), sitekey: env.TURNSTILE_SITEKEY || null });
}

async function submit(context, data) {
  const { env, request } = context, db = env.COMMENTS_DB;
  const article = await articleInfo(context, data.post);
  const id = identifier(data.id), owner = await ownerHash(request, article.id, true);
  const nickname = field(data.nickname, '昵称', 40, true) || '游客';
  const body = field(data.body, '留言', 2000);
  const existing = () => db.prepare('SELECT state FROM comments WHERE id=? AND article=? AND owner_hash=?')
    .bind(id, article.id, owner).first();
  const prior = await existing();
  if (prior) return json({ id, state: prior.state });
  await limit(request, env, 'comment', 5);
  await verifyHuman(request, env, data.token, 'comment');
  const normalized = body.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  const links = normalized.match(/https?:\/\//g)?.length || 0;
  const fingerprint = await digest(normalized);
  await db.prepare(`
    INSERT INTO comments(id,article,title,nickname,body,owner_hash,fingerprint,state,created_at)
    VALUES(?,?,?,?,?,?,?,CASE WHEN ? OR (? AND EXISTS(
      SELECT 1 FROM comments WHERE fingerprint=? AND article<>?
    )) THEN 'pending' ELSE 'published' END,?) ON CONFLICT(id) DO NOTHING
  `).bind(id, article.id, article.title, nickname, body, owner, fingerprint,
    Number(links >= 4), Number(links > 0 || normalized.length >= 30), fingerprint, article.id, Date.now()).run();
  const stored = await existing();
  if (!stored) throw new CommentError(409, '提交编号冲突，请刷新后重试。');
  return json({ id, state: stored.state }, 201);
}

const reasons = new Set(['spam', 'abuse', 'removal', 'other']);

async function feedback(context, id, data) {
  const { request, env } = context, db = env.COMMENTS_DB;
  const report = identifier(data.id);
  if (!reasons.has(data.reason)) throw new CommentError(400, '请选择反馈原因。');
  const detail = field(data.detail, '补充说明', 500, true);
  await limit(request, env, 'feedback', 8);
  await verifyHuman(request, env, data.token, 'feedback');
  const result = await db.prepare(`
    INSERT INTO feedback(id,comment_id,reason,detail,created_at)
    SELECT ?,id,?,?,? FROM comments WHERE id=? AND state='published'
    ON CONFLICT(id) DO NOTHING
  `).bind(report, data.reason, detail, Date.now(), id).run();
  if (!result.meta.changes && !await db.prepare('SELECT id FROM feedback WHERE id=? AND comment_id=?').bind(report, id).first())
    throw new CommentError(404, '该留言已移除。');
  return json({ received: true });
}

export async function publicComments(context) {
  const { request, env } = context, url = new URL(request.url);
  const route = url.pathname.replace(/\/$/, '');
  if (route === '/api/comments' && request.method === 'GET') return list(context, url);
  if (request.method !== 'POST') throw new CommentError(405, '请求方式不支持。');
  const data = await input(request);
  if (route === '/api/comments') return submit(context, data);
  const match = /^\/api\/comments\/([^/]+)\/(withdraw|feedback)$/.exec(route);
  if (!match) throw new CommentError(404, '接口不存在。');
  const id = identifier(match[1]);
  if (match[2] === 'feedback') return feedback(context, id, data);
  const article = field(data.post, '文章', 300), owner = await ownerHash(request, article, true);
  const result = await env.COMMENTS_DB.prepare('DELETE FROM comments WHERE id=? AND article=? AND owner_hash=?')
    .bind(id, article, owner).run();
  if (!result.meta.changes) throw new CommentError(404, '留言已移除，或此浏览器没有撤回凭证。');
  return json({ withdrawn: true });
}
