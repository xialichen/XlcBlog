import type { APIRoute } from 'astro';
import { getPosts } from '../lib/posts';

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  return Response.json(Object.fromEntries(posts.map(post => [post.id, post.data.category])));
};
