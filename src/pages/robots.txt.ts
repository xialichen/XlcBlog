import type { APIRoute } from 'astro';

export const prerender = true;
export const GET: APIRoute = ({ site }) => {
  const sections = [
    'User-agent: Bytespider\nAllow: /',
    'User-agent: Sogou web spider\nAllow: /',
    'User-agent: *\nAllow: /',
  ];
  if (site) sections.push(`Sitemap: ${new URL('/sitemap.xml', site)}`);
  return new Response(sections.join('\n\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
