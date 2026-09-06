import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { normalizeDate } from '../src/lib/content/metadata.mjs';

export async function validateContent(postsDir = path.join(process.cwd(), 'content/posts')) {
  const posts = [];
  const slugs = new Set();
  for (const file of (await fs.readdir(postsDir)).filter((file) => /\.mdx?$/i.test(file))) {
    const { data } = matter(await fs.readFile(path.join(postsDir, file), 'utf8'));
    if (data.draft === true) continue;
    try {
      const date = normalizeDate(data.date);
      if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Missing title');
      const slug = String(data.slug || file.replace(/\.mdx?$/i, ''));
      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new Error(`Invalid slug: ${slug}`);
      if (slugs.has(slug)) throw new Error(`Duplicate slug: ${slug}`);
      slugs.add(slug);
      posts.push({ ...data, slug, date });
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  for (const post of posts.slice(0, 10)) {
    if (typeof post.description !== 'string' || !post.description.trim())
      throw new Error(`${post.slug}: latest posts require a description`);
  }
  console.log(
    `Content validated: ${posts.length} posts; latest ${posts[0]?.date.slice(0, 10) || 'none'}`,
  );
  return posts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await validateContent();
