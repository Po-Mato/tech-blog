import { normalizeTag } from './content/metadata.mjs';
export type SearchConditions = { q: string; tag: string; sort: 'relevance' | 'new' };

// An unknown tag must be preserved until the index is successfully loaded.
export function readSearchConditions(params: Pick<URLSearchParams, 'get'>, tags?: string[]): SearchConditions {
  const tag = normalizeTag(params.get('tag') ?? '') || 'all';
  return {
    q: params.get('q') ?? '',
    tag: tags && tag !== 'all' && !tags.includes(tag) ? 'all' : tag,
    sort: params.get('sort') === 'new' ? 'new' : 'relevance',
  };
}

export function updateSearchUrl(href: string, patch: Partial<SearchConditions>, tags?: string[]) {
  const url = new URL(href);
  const state = { ...readSearchConditions(url.searchParams, tags), ...patch };
  for (const [key, value] of Object.entries(state)) {
    if (!value || (key === 'tag' && value === 'all') || (key === 'sort' && value === 'relevance')) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
