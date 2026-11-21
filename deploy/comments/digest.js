const DAY = 86_400_000;

// 每个环境使用独立的数据库与发信绑定。计划任务也负责清理到期的隐藏留言。
export async function runDigest(env, now = Date.now()) {
  const db = env.COMMENTS_DB;
  await db.batch([
    db.prepare("DELETE FROM comments WHERE state='hidden' AND hidden_at<=?").bind(now - 30 * DAY),
    db.prepare('DELETE FROM comment_limits WHERE expires_at<=?').bind(now),
  ]);
  const day = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
  const since = await db.prepare('SELECT COALESCE(MAX(through_time),0) AS cutoff FROM comment_digests WHERE sent=1').first('cutoff');
  const { results } = await db.prepare(`
    SELECT article,title,SUM(pending) AS pending,SUM(reported) AS reported FROM (
      SELECT article,title,1 AS pending,0 AS reported FROM comments
      WHERE state='pending' AND created_at>=? AND created_at<?
      UNION ALL
      SELECT c.article,c.title,0,1 FROM feedback f JOIN comments c ON c.id=f.comment_id
      WHERE f.resolved_at IS NULL AND f.created_at>=? AND f.created_at<? GROUP BY c.id
    ) GROUP BY article,title ORDER BY article
  `).bind(since, now, since, now).all();
  if (!results.length) return 'empty';
  if (!env.MAIL || !env.OWNER_EMAIL || !env.MAIL_FROM || !env.ADMIN_URL) throw new Error('Missing digest configuration');
  // 先认领当天发送权。即便邮件服务应答丢失，也不会在同一天重复投递。
  const claim = await db.prepare('INSERT INTO comment_digests(day,through_time) VALUES(?,?) ON CONFLICT(day) DO NOTHING')
    .bind(day, now).run();
  if (!claim.meta.changes) return 'already-claimed';
  const pending = results.reduce((sum, row) => sum + row.pending, 0);
  const reported = results.reduce((sum, row) => sum + row.reported, 0);
  const lines = results.slice(0, 100).map(row => row.title + '（待审 ' + row.pending + '，有反馈 ' + row.reported + '）');
  if (results.length > 100) lines.push('其余文章可在管理页查看。');
  const text = ['待审留言 ' + pending + ' 条，有新反馈的留言 ' + reported + ' 条。', '', ...lines, '', env.ADMIN_URL].join('\n');
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const html = '<p>' + escape(text.slice(0, text.lastIndexOf(env.ADMIN_URL)).trim()).replaceAll('\n', '<br>') +
    '</p><p><a href="' + escape(env.ADMIN_URL) + '">打开评论管理页</a></p>';
  await env.MAIL.send({ from: env.MAIL_FROM, to: env.OWNER_EMAIL, subject: '博客评论待办 · ' + day, text, html });
  await db.prepare('UPDATE comment_digests SET sent=1 WHERE day=?').bind(day).run();
  return 'sent';
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDigest(env, event.scheduledTime));
  },
};
