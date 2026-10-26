export function readTagQuery(search: string): string {
  return new URLSearchParams(search).get('q') ?? '';
}

export function tagQueryHref(href: string, query: string): string {
  const url = new URL(href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  return url.pathname + url.search + url.hash;
}
