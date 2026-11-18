import type { APIRoute } from 'astro';
import { getPosts } from '../lib/posts';
import { projects } from '../data/site';

// 与文章详情页共用筛选：draft: true 不生成详情，也不进入站点地图。
export const prerender = true;
const escapeXml = (value: string) => value.replace(/[<>&"']/g, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[character]!);

export const GET: APIRoute = async ({ site }) => {
  // 本地未配置域名时不输出 localhost 或错误的生产网址。
  if (!site) return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />\n', {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
  const posts = await getPosts();
  // 显式列出公开页面，不扫描 public/ 下的验证文件、模板或其他资源。
  const paths = [
    '/', '/about/', '/writing/', '/projects/',
    ...projects.map(project => `/projects/${project.slug}/`),
    ...posts.map(post => `/writing/${post.id}/`),
  ];
  const urls = [...new Set(paths.map(path => new URL(path, site).href))].sort();
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(url => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  // 不用发布日期或本次构建时间冒充最后修改时间。
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
