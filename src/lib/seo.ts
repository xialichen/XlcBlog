import { profile } from '../data/site';

export const websiteId = (site: URL) => new URL('/#website', site).href;

export function authorSchema(site: URL) {
  const url = new URL('/about/', site).href;
  return {
    '@type': 'Person',
    '@id': url + '#person',
    name: profile.name,
    url,
    sameAs: profile.github ? [profile.github] : undefined,
  };
}
