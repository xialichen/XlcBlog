import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { onRequest as publicRoute } from '../functions/api/comments/[[path]].js';
import { onRequest as adminRoute } from '../functions/admin/comments/[[path]].js';
import { runDigest } from '../deploy/comments/digest.js';

const schema = readFileSync(new URL('../deploy/comments/schema.sql', import.meta.url), 'utf8');
const origin = 'https://comments.example', key = 'ac'.repeat(32);

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(schema);
  function statement(query, args = []) {
    const stmt = sql.prepare(query);
    return {
      bind: (...values) => statement(query, values),
      first(column) { const row = stmt.get(...args); return column ? row?.[column] ?? null : row ?? null; },
      all: () => ({ results: stmt.all(...args) }),
      run: () => ({ meta: stmt.run(...args) }),
    };
  }
  return { sql, binding: { prepare: statement, batch(statements) {
    sql.exec('BEGIN');
    try { const results = statements.map(s => s.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } };
}

async function fixture(t) {
  const { sql, binding } = database();
  t.after(() => sql.close());
  const sent = [], email = 'owner@example.test';
  const env = {
    COMMENTS_DB: binding, COMMENT_HOSTS: 'comments.example', COMMENT_RATE_SECRET: 'test-rate',
    TURNSTILE_SECRET: 'test-captcha', TURNSTILE_SITEKEY: 'test-site',
    ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'comment-admin-test',
    OWNER_EMAIL: email, MAIL_FROM: 'comments@example.test', ADMIN_URL: origin + '/admin/comments/',
    MAIL: { send: async message => sent.push(message) },
    ASSETS: { fetch(url) {
      const id = new URL(url).pathname.slice('/comment-articles/'.length, -5);
      return ['alpha', 'beta'].includes(id) ? Response.json({ id, title: id + ' 标题' }) : new Response('', { status: 404 });
    } },
  };
  const keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: crypto.randomUUID(), alg: 'RS256' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('/certs')) return Response.json({ keys: [jwk] });
    assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const action = options.body.get('response');
    return Response.json({ success: action !== 'invalid', hostname: 'comments.example', action });
  });
  const jwt = await new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(env.ACCESS_ISSUER).setAudience(env.ACCESS_AUD).setExpirationTime('10m').sign(keys.privateKey);
  let address = 0;
  async function call(path, data, headers = {}) {
    const request = new Request(origin + path, { method: data ? 'POST' : 'GET', headers: {
      'CF-Connecting-IP': '192.0.2.' + ++address, ...(data ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers,
    }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const response = await (path.startsWith('/admin/') ? adminRoute : publicRoute)({ env, request });
    return { status: response.status, data: await response.json() };
  }
  const owner = { 'X-Comment-Key': key }, admin = { 'Cf-Access-Jwt-Assertion': jwt };
  const submit = (post, body, id = crypto.randomUUID(), other = {}) =>
    call('/api/comments', { post, body, id, token: 'comment', ...other }, owner);
  return { env, call, submit, sql, sent, owner, admin };
}

test('发表、审核、反馈、回复和撤回经实际路由保持一致', async t => {
  const { env, call, submit, sql, sent, owner, admin } = await fixture(t);
  const body = '这里有一条资料来源 https://example.org/reference';
  const first = await submit('alpha', body);
  assert.equal(first.data.state, 'published');
  assert.equal((await submit('alpha', body, first.data.id)).status, 200);
  assert.equal((await submit('beta', body)).data.state, 'pending');
  assert.equal((await call('/api/comments?post=beta')).data.items.length, 0);
  const pending = (await call('/api/comments?post=beta', undefined, owner)).data.items[0];
  assert.equal(pending.mine, 1);
  const base = '/admin/comments/api/' + first.data.id + '/';
  assert.equal((await call(base + 'reply', { body: '谢谢补充' })).status, 403);
  assert.equal((await call(base + 'reply', { body: '谢谢补充' }, admin)).status, 200);
  const publicRow = (await call('/api/comments?post=alpha')).data.items[0];
  assert.equal(publicRow.reply, '谢谢补充');
  assert.equal(publicRow.nickname, '游客');
  assert.equal(publicRow.owner_hash, undefined);
  for (const reason of ['abuse', 'removal']) {
    assert.equal((await call('/api/comments/' + first.data.id + '/feedback',
      { id: crypto.randomUUID(), reason, detail: '请核实', token: 'feedback' })).status, 200);
  }
  const tasks = (await call('/admin/comments/api?filter=tasks', undefined, admin)).data.items;
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find(r => r.id === first.data.id).reports, 2);
  assert.equal((await call(base + 'feedback', undefined, admin)).data.items.length, 2);
  const now = Date.now() + 1000;
  assert.equal(await runDigest(env, now), 'sent');
  assert.equal(await runDigest(env, now + 1), 'empty');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes('有新反馈的留言 1 条'));
  assert.ok(!sent[0].text.includes('请核实'));
  assert.equal((await call(base + 'hide', {}, admin)).status, 200);
  assert.equal((await call('/api/comments?post=alpha')).data.items.length, 0);
  assert.equal((await call(base + 'restore', {}, admin)).status, 200);
  assert.equal((await call('/admin/comments/api/' + pending.id + '/publish', {}, admin)).status, 200);
  const withdraw = '/api/comments/' + first.data.id + '/withdraw';
  assert.equal((await call(withdraw, { post: 'alpha' }, { 'X-Comment-Key': 'cd'.repeat(32) })).status, 404);
  assert.equal((await call(withdraw, { post: 'alpha' }, owner)).status, 200);
  assert.equal(sql.prepare('SELECT count(*) n FROM feedback').get().n, 0);
  assert.equal(sql.prepare('SELECT count(*) n FROM comments WHERE reply IS NOT NULL').get().n, 0);
  await call('/admin/comments/api/' + pending.id + '/hide', {}, admin);
  await runDigest(env, now + 31 * 86_400_000);
  assert.equal(sql.prepare('SELECT count(*) n FROM comments').get().n, 0);
});

test('限频、文章白名单、分页和失败提交', async t => {
  const { call, submit, sql, owner } = await fixture(t);
  assert.equal((await submit('sample', '测试')).status, 404);
  assert.equal((await submit('alpha', '测试', undefined, { token: '' })).status, 400);
  assert.equal((await submit('alpha', '测试', undefined, { token: 'invalid' })).status, 403);
  assert.equal((await submit('alpha', '测试', undefined, { token: 'feedback' })).status, 403);
  assert.equal(sql.prepare('SELECT count(*) n FROM comments').get().n, 0);
  const data = { post: 'alpha', body: '留言', token: 'comment' };
  for (let i = 0; i < 6; i++) {
    const result = await call('/api/comments', { ...data, id: crypto.randomUUID() }, { ...owner, 'CF-Connecting-IP': '198.51.100.1' });
    assert.equal(result.status, i < 5 ? 201 : 429);
  }
  for (let i = 0; i < 17; i++) assert.equal((await submit('alpha', String(i))).status, 201);
  const list = (await call('/api/comments?post=alpha')).data;
  assert.equal(list.items.length, 20);
  const later = (await call('/api/comments?post=alpha&before=' + list.next)).data;
  assert.equal(later.items.length, 2);
  assert.equal(new Set([...list.items, ...later.items].map(x => x.id)).size, 22);
  assert.equal(sql.prepare('SELECT count(*) n FROM comments').get().n, 22);
});
