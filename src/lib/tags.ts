import { getAllPosts } from "./posts";

export type TagCount = {
  tag: string;
  count: number;
};

export function normalizeTag(tag: string): string {
  return tag.trim();
}

export async function getAllTags(): Promise<TagCount[]> {
  const posts = await getAllPosts();
  const map = new Map<string, number>();

  for (const p of posts) {
    for (const raw of p.tags ?? []) {
      const t = normalizeTag(raw);
      if (!t) continue;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }

  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) =>
      a.count !== b.count ? b.count - a.count : a.tag.localeCompare(b.tag)
    );
}

export function tagToSlug(tag: string): string {
  return encodeURIComponent(tag);
}

export function slugToTag(slug: string): string {
  return decodeURIComponent(slug);
}
