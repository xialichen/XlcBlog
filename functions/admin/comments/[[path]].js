import { adminApi, verifyOwner } from '../../../server/comments/admin.js';
import { CommentError, handle } from '../../../server/comments/http.js';

export const onRequest = context => handle(async () => {
  await verifyOwner(context.request, context.env);
  const path = new URL(context.request.url).pathname.replace(/^\/admin\/comments\/?/, '').replace(/\/$/, '');
  if (path === 'api' || path.startsWith('api/')) return adminApi(context, path.slice(4));
  if ((path === '' || path === 'index.html') && context.request.method === 'GET') {
    const asset = await context.next();
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
  }
  throw new CommentError(404, '页面不存在。');
});
