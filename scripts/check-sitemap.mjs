import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = new URL(process.env.SITE_URL || 'https://www.xialichen.com');
const root = new URL('../dist/', import.meta.url);
const rootPath = fileURLToPath(root);
const xml = await readFile(new URL('sitemap.xml', root), 'utf8');
assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
assert.match(xml, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.equal(new Set(urls).size, urls.length, '站点地图不能含重复网址');
assert.ok(urls.length > 0, '生产站点地图不能为空');
assert.ok(!xml.includes('<lastmod>'), '不能伪造最后修改时间');
const expected = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.html') && entry.name !== '404.html') {
      const route = relative(rootPath, path).split(sep).join('/').replace(/index\.html$/, '');
      if (route.startsWith('admin/')) continue;
      expected.push(new URL(route, base).href);
    }
  }
}
await walk(rootPath);
assert.deepEqual([...urls].sort(), expected.sort(), '地图必须与实际生成的公开 HTML 页面一致（排除404）');
const robots = await readFile(new URL('robots.txt', root), 'utf8');
assert.ok(robots.includes(`Sitemap: ${new URL('/sitemap.xml', base).href}`));
assert.ok(!robots.includes('Disallow: /'));
console.log(`站点地图检查通过：${urls.length} 个公开页面，无重复、404或遗漏；robots地址正确。`);
