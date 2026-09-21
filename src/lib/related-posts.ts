import type { PostMeta } from './posts';
import { normalizeTags } from './content/metadata.mjs';

const broadTags = new Set(['AI', 'AI Agents', 'Architecture', 'Agentic AI', '2026', '2026 Trends', 'trends', 'Software Engineering']);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Candidate = PostMeta & { draft?: boolean };

/** Published, specific-tag matches only; no popularity or personal data. */
export function relatedPosts(current: PostMeta, input: Candidate[], excluded: string[] = []) {
  const unique = new Map<string, Candidate>();
  for (const post of input.filter(p => !p.draft).sort((a, b) =>
    compare(a.slug, b.slug) || compare(b.date, a.date) || compare(JSON.stringify(a), JSON.stringify(b)))) {
    if (!unique.has(post.slug)) unique.set(post.slug, post);
  }
  const corpus = [...unique.values()].map(post => ({ post, tags: normalizeTags(post.tags).sort(compare) }));
  const frequencies = new Map<string, number>();
  for (const { tags } of corpus) for (const tag of tags) frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
  const wanted = new Set(normalizeTags(current.tags).filter(tag => !broadTags.has(tag)));
  const blocked = new Set([current.slug, ...excluded]);
  return corpus.filter(({ post }) => !blocked.has(post.slug)).map(({ post, tags }) => {
    const sharedTags = tags.filter(tag => wanted.has(tag));
    const score = sharedTags.reduce((sum, tag) => sum + Math.log((corpus.length + 1) / ((frequencies.get(tag) ?? 0) + 1)), 0);
    return { post, sharedTags, score };
  }).filter(item => item.sharedTags.length > 0)
    .sort((a, b) => b.score - a.score || compare(b.post.date, a.post.date) || compare(a.post.slug, b.post.slug))
    .slice(0, 3);
}
