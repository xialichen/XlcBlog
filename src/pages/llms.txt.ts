import type { APIRoute } from 'astro';
import { profile, projects } from '../data/site';
import { getPosts } from '../lib/posts';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const posts = (await getPosts()).filter(post => !post.data.sample);
  const recentArticles = posts.filter(post => post.data.format === 'article').slice(0, 5);
  const latestBriefing = posts.find(post => post.data.format === 'briefing' && post.data.category === '南沙区政府早报');

  const link = (title: string, path: string, description: string) => {
    const url = site ? new URL(path, site).href : path;
    const label = title.trim().replace(/\s+/g, ' ').replace(/[\\[\]]/g, '\\$&');
    return `- [${label}](${url}): ${description.trim().replace(/\s+/g, ' ')}`;
  };

  const projectLinks = projects.filter(project => !project.sample).map(project =>
    link(project.name, `/projects/${project.slug}/`, project.description),
  );
  const sections = [
    `# ${profile.title}`,
    `> ${profile.description}`,
    [
      '## 站点入口',
      '',
      link('文章归档', '/writing/', '浏览全部文章，可按分类查找往期早报。'),
      link('项目列表', '/projects/', '查看 Qt 桌面应用工具、组件与博客项目。'),
      link('关于作者', '/about/', '了解作者与这个博客。'),
    ].join('\n'),
  ];

  if (recentArticles.length > 0) {
    sections.push([
      '## 近期文章',
      '',
      ...recentArticles.map(({ id, data }) => link(data.title, `/writing/${id}/`, data.description)),
    ].join('\n'));
  }

  if (projectLinks.length > 0) {
    sections.push(['## 项目', '', ...projectLinks].join('\n'));
  }

  if (latestBriefing) {
    sections.push([
      '## 南沙区政府早报',
      '',
      link(latestBriefing.data.title, `/writing/${latestBriefing.id}/`, latestBriefing.data.description),
    ].join('\n'));
  }

  return new Response(sections.join('\n\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
