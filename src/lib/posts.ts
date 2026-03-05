import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

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

const postsDirectory = path.join(process.cwd(), "content", "posts");

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

export async function getPostSlugs(): Promise<string[]> {
  const files = await fs.readdir(postsDirectory);
  return files
    .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
    .map((f) => f.replace(/\.(md|mdx)$/i, ""));
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

  if (!filePath) return null;

  const raw = await fs.readFile(filePath, "utf8");
  const { data, content } = matter(raw);

  const meta: PostMeta = {
    slug: String(data.slug || slug),
    title: String(data.title || slug),
    date: String(data.date || ""),
    description: data.description ? String(data.description) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
  };

  const contentHtml = await markdownToHtml(content);

  return {
    ...meta,
    contentHtml,
  };
}

export async function getAllPosts(): Promise<PostMeta[]> {
  const slugs = await getPostSlugs();
  const posts = await Promise.all(slugs.map((s) => getPostBySlug(s)));

  return posts
    .filter((p): p is Post => Boolean(p))
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      date: p.date,
      description: p.description,
      tags: p.tags,
    }))
    .sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });
}
