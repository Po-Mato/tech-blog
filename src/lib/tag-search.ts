export function normalizeTagQuery(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
export function filterTagNames<T extends { tag: string }>(tags: T[], query: string): T[] {
  const needle = normalizeTagQuery(query);
  return tags.filter(({ tag }) => normalizeTagQuery(tag).includes(needle));
}
