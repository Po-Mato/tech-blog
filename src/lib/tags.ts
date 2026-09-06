import { getAllPosts } from './posts';

export type TagCount = {
  tag: string;
  count: number;
};

export { normalizeTag } from './content/metadata.mjs';
import { normalizeTag, normalizeTags, TAG_ALIASES } from './content/metadata.mjs';

export function tagMatches(rawTag: string, targetTag: string): boolean {
  return normalizeTag(rawTag) === normalizeTag(targetTag);
}

export async function getAllTags(): Promise<TagCount[]> {
  const posts = await getAllPosts();
  const map = new Map<string, number>();

  for (const p of posts) {
    for (const raw of normalizeTags(p.tags)) {
      const t = normalizeTag(raw);
      if (!t) continue;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }

  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.tag.localeCompare(b.tag)));
}

export function tagToSlug(tag: string): string {
  return encodeURIComponent(tag);
}

export function slugToTag(slug: string): string {
  return decodeURIComponent(slug);
}

// Keep previously shared tag URLs available, with canonical metadata pointing to the merged tag.
export async function getTagRoutes(): Promise<string[]> {
  const tags = await getAllTags();
  const names = new Set(tags.map(({ tag }) => tag));
  return [
    ...names,
    ...Object.entries(TAG_ALIASES)
      .filter(([, canonical]) => names.has(canonical))
      .map(([alias]) => alias),
  ];
}
