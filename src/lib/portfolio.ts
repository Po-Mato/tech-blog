import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

export type PortfolioMeta = {
  slug: string;
  title: string;
  date?: string; // optional (e.g., "2025-01")
  description?: string;
  stack?: string[];
  role?: string;
  links?: {
    github?: string;
    demo?: string;
    doc?: string;
  };
};

export type PortfolioItem = PortfolioMeta & {
  contentHtml: string;
};

const portfolioDirectory = path.join(process.cwd(), "content", "portfolio");

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

export async function getPortfolioSlugs(): Promise<string[]> {
  const files = await fs.readdir(portfolioDirectory);
  return files
    .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
    .map((f) => f.replace(/\.(md|mdx)$/i, ""));
}

export async function getPortfolioBySlug(slug: string): Promise<PortfolioItem | null> {
  const candidates = [
    path.join(portfolioDirectory, `${slug}.md`),
    path.join(portfolioDirectory, `${slug}.mdx`),
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

  const meta: PortfolioMeta = {
    slug: String(data.slug || slug),
    title: String(data.title || slug),
    date: data.date ? String(data.date) : undefined,
    description: data.description ? String(data.description) : undefined,
    stack: Array.isArray(data.stack) ? data.stack.map(String) : undefined,
    role: data.role ? String(data.role) : undefined,
    links: data.links && typeof data.links === "object"
      ? {
          github: typeof data.links.github === "string" ? data.links.github : undefined,
          demo: typeof data.links.demo === "string" ? data.links.demo : undefined,
          doc: typeof data.links.doc === "string" ? data.links.doc : undefined,
        }
      : undefined,
  };

  const contentHtml = await markdownToHtml(content);

  return {
    ...meta,
    contentHtml,
  };
}

export async function getAllPortfolio(): Promise<PortfolioMeta[]> {
  const slugs = await getPortfolioSlugs();
  const items = await Promise.all(slugs.map((s) => getPortfolioBySlug(s)));

  return items
    .filter((p): p is PortfolioItem => Boolean(p))
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      date: p.date,
      description: p.description,
      stack: p.stack,
      role: p.role,
      links: p.links,
    }))
    .sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : -1));
}
