import type { APIRoute, GetStaticPaths } from 'astro';
import { getPosts } from '../../lib/posts';

export const getStaticPaths = (async () =>
  (await getPosts()).filter(post => !post.data.sample).map(post => ({
    params: { slug: post.id }, props: { id: post.id, title: post.data.title },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => Response.json({ id: props.id, title: props.title });
