import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';

const site = process.env.SITE_URL;
const legacyOrigin = 'https://1610161.xyz';

// 早报原稿带正文校验值，在渲染阶段更新其中的站内文章链接。
const legacyArticleLinks = {
  name: 'legacy-article-links',
  element: {
    filter: ['a'],
    visit(node, context) {
      const href = node.properties.href;
      if (typeof href === 'string' && href.startsWith(`${legacyOrigin}/writing/`)) {
        context.setProperty(node, 'href', href.slice(legacyOrigin.length));
      }
    },
  },
};

export default defineConfig({
  ...(site ? { site } : {}),
  output: 'static',
  trailingSlash: 'always',
  markdown: {
    processor: satteri({ hastPlugins: [legacyArticleLinks] }),
    // 让语法高亮跟随站点的 CSS 颜色变量，统一深浅主题。
    shikiConfig: { theme: 'css-variables' },
  },
});
