import fs from 'node:fs/promises';
import path from 'node:path';

import matter from 'gray-matter';
import { normalizeDate, normalizeTags } from './content/metadata.mjs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

export type PostMeta = {
  slug: string;
  title: string;
  date: string;
  description?: string;
  tags?: string[];
};

export type Post = PostMeta & {
  contentHtml: string;
};

const postsDirectory = path.join(process.cwd(), 'content', 'posts');

const postFilePattern = /\.(md|mdx)$/i;

async function markdownToHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}

async function readPostFile(filePath: string, fallbackSlug: string): Promise<Post | null> {
  const raw = await fs.readFile(filePath, 'utf8');
  const { data, content } = matter(raw);

  if (data.draft === true) return null;

  const meta: PostMeta = {
    slug: String(data.slug || fallbackSlug),
    title: String(data.title || fallbackSlug),
    date: normalizeDate(data.date),
    description: data.description ? String(data.description) : undefined,
    tags: normalizeTags(data.tags),
  };

  const contentHtml = await markdownToHtml(content);

  return {
    ...meta,
    contentHtml,
  };
}

export async function getPostSlugs(): Promise<string[]> {
  const files = await fs.readdir(postsDirectory);
  const contentFiles = files.filter((f) => postFilePattern.test(f));
  const slugs = await Promise.all(
    contentFiles.map(async (file) => {
      const fallbackSlug = file.replace(postFilePattern, '');
      const raw = await fs.readFile(path.join(postsDirectory, file), 'utf8');
      const { data } = matter(raw);

      return data.draft === true ? null : String(data.slug || fallbackSlug);
    }),
  );

  return slugs.filter((slug): slug is string => slug !== null);
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const candidates = [
    path.join(postsDirectory, `${slug}.md`),
    path.join(postsDirectory, `${slug}.mdx`),
  ];

  let filePath: string | null = null;
  for (const p of candidates) {
    try {
      await fs.access(p);
      filePath = p;
      break;
    } catch {
      // continue
    }
  }

  if (!filePath) {
    const files = (await fs.readdir(postsDirectory)).filter((f) => postFilePattern.test(f));

    for (const file of files) {
      const fallbackSlug = file.replace(postFilePattern, '');
      const candidatePath = path.join(postsDirectory, file);
      const raw = await fs.readFile(candidatePath, 'utf8');
      const { data } = matter(raw);

      if (data.draft === true) continue;
      if (String(data.slug || fallbackSlug) === slug) {
        filePath = candidatePath;
        break;
      }
    }
  }

  if (!filePath) return null;

  return readPostFile(filePath, slug);
}

export async function getAllPosts(): Promise<PostMeta[]> {
  const files = (await fs.readdir(postsDirectory)).filter((file) => postFilePattern.test(file));
  const posts = await Promise.all(
    files.map(async (file): Promise<PostMeta | null> => {
      const { data } = matter(await fs.readFile(path.join(postsDirectory, file), 'utf8'));
      if (data.draft === true) return null;
      const slug = String(data.slug || file.replace(postFilePattern, ''));
      return {
        slug,
        title: String(data.title || slug),
        date: normalizeDate(data.date),
        description: data.description ? String(data.description) : undefined,
        tags: normalizeTags(data.tags),
      };
    }),
  );
  return posts
    .filter((post): post is PostMeta => post !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}
