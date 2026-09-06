import { describe, expect, it } from 'vitest';
import { featuredSlugs, pageCount, pageHref, postsOnPage, series } from './editorial';
import { getAllPosts } from './posts';

describe('blog reading paths', () => {
  it('paginates the whole archive without gaps or duplicates', async () => {
    const posts = await getAllPosts();
    const pages = Array.from({ length: pageCount(posts.length) }, (_, i) =>
      postsOnPage(posts, i + 1),
    );
    expect(pages[0]).toHaveLength(10);
    expect(pages.flat()).toEqual(posts);
    expect(postsOnPage(posts, 0)).toEqual([]);
    expect(postsOnPage(posts, pageCount(posts.length) + 1)).toEqual([]);
    expect(pageHref(1)).toBe('/');
    expect(pageHref(2)).toBe('/archive/2/');
  });
  it('has three published recommendations and valid, nonduplicated series reading orders', async () => {
    const posts = await getAllPosts();
    const slugs = new Set(posts.map((post) => post.slug));
    expect(new Set(featuredSlugs).size).toBe(3);
    for (const slug of featuredSlugs) expect(slugs.has(slug)).toBe(true);
    for (const item of series) {
      expect(item.slugs.length).toBeGreaterThan(1);
      expect(new Set(item.slugs).size).toBe(item.slugs.length);
      for (const slug of item.slugs) expect(slugs.has(slug)).toBe(true);
    }
  });
  it('orders September posts ahead of April posts and supplies latest summaries', async () => {
    const posts = await getAllPosts();
    expect(posts.findIndex((post) => post.slug === '2026-09-02-proactive-update')).toBeLessThan(
      posts.findIndex((post) => post.slug === '2026-04-14-proactive-update'),
    );
    expect(posts.slice(0, 10).every((post) => Boolean(post.description?.trim()))).toBe(true);
    expect(posts.every((post, index) => index === 0 || posts[index - 1].date >= post.date)).toBe(
      true,
    );
  });
});
