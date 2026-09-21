import { describe, it, expect } from 'vitest';
import { relatedPosts } from './related-posts';
import { getAllPosts } from './posts';
import { series } from './editorial';
const p = (slug: string, tags: string[] = [], date = '2026-01-01') => ({ slug, tags, date, title: slug });
describe('related posts', () => {
  it('rejects broad-only overlap and empty tags', () => {
    expect(relatedPosts(p('self', ['AI', '2026 Trends']), [p('other', ['AI', '2026 Trends'])])).toEqual([]);
    expect(relatedPosts(p('self'), [p('other', ['MCP'])])).toEqual([]);
  });
  it('normalizes aliases, deduplicates tags, and exposes reasons', () => {
    const r = relatedPosts(p('self', ['Cloud-Native']), [p('other', ['Cloud Native', 'Cloud-Native', 'AI'])]);
    expect(r[0].sharedTags).toEqual(['Cloud Native']);
  });
  it('excludes self, series entries, drafts and duplicate slugs', () => {
    const posts = [p('self', ['MCP']), p('series', ['MCP']), {...p('draft', ['MCP']), draft: true}, p('ok', ['MCP']), p('ok', ['MCP'])];
    expect(relatedPosts(posts[0], posts, ['series']).map(r => r.post.slug)).toEqual(['ok']);
  });
  it('ranks rare shared tags above common ones', () => {
    const posts = [p('rare', ['WebGPU']), p('common', ['MCP']), p('filler', ['MCP'])];
    expect(relatedPosts(p('self', ['WebGPU', 'MCP']), posts)[0].post.slug).toBe('rare');
  });
  it('limits to three and breaks ties by date then slug regardless of input order', () => {
    const posts = [p('z', ['MCP']), p('b', ['MCP'], '2026-02-01'), p('a', ['MCP'], '2026-02-01'), p('c', ['MCP'])];
    const actual = relatedPosts(p('self', ['MCP']), posts);
    expect(actual.map(r => r.post.slug)).toEqual(['a', 'b', 'c']);
    expect(relatedPosts(p('self', ['MCP']), [...posts].reverse())).toEqual(actual);
  });
  it('links real Cloud Native articles and preserves series exclusion', async () => {
    const posts = await getAllPosts();
    const current = posts.find(p => p.slug === '2026-08-29-proactive-update')!;
    expect(relatedPosts(current, posts).map(r => r.post.slug)).toEqual(['2026-09-02-proactive-update', '2026-08-26-proactive-update', '2026-08-09-proactive-update']);
    for (const item of series) {
      const post = posts.find(p => p.slug === item.slugs[0])!;
      expect(relatedPosts(post, posts, item.slugs).every(r => !item.slugs.includes(r.post.slug))).toBe(true);
    }
  });
});
