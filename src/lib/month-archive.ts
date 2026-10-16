import type { PostMeta } from './posts';
export const monthHref = (month: string) => `/archive/month/${month}/`;
export const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
export function groupByMonth(posts: PostMeta[]) {
  const groups = new Map<string, PostMeta[]>();
  const seen = new Set<string>();
  for (const post of [...posts].sort((a,b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))) {
    const day = post.date.slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(post.date)) || new Date(day).toISOString().slice(0,10) !== day || seen.has(post.slug)) continue;
    seen.add(post.slug);
    const month = day.slice(0,7);
    groups.set(month, [...(groups.get(month) || []), post]);
  }
  return [...groups].sort(([a],[b]) => b.localeCompare(a)).map(([month, posts]) => ({month, posts}));
}
