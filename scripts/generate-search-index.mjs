import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

const POSTS_DIR = path.join(process.cwd(), "content", "posts");
const PORTFOLIO_DIR = path.join(process.cwd(), "content", "portfolio");
const OUT_FILE = path.join(process.cwd(), "public", "search-index.json");

function stripMarkdown(md) {
  return (
    md
      // code fences
      .replace(/```[\s\S]*?```/g, " ")
      // inline code
      .replace(/`[^`]*`/g, " ")
      // images ![alt](url)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      // links [text](url)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // headings / emphasis / blockquotes / lists
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/[*_~]+/g, "")
      // HTML tags
      .replace(/<[^>]+>/g, " ")
      // collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function readDocsFromDir(dir, { type }) {
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => /\.(md|mdx)$/i.test(f));
  } catch {
    // directory may not exist
    return [];
  }

  const out = [];
  for (const f of files) {
    const fallbackSlug = f.replace(/\.(md|mdx)$/i, "");
    const raw = await fs.readFile(path.join(dir, f), "utf8");
    const parsed = matter(raw);

    const slug = String(parsed.data.slug || fallbackSlug);
    const title = String(parsed.data.title || slug);
    const description = parsed.data.description ? String(parsed.data.description) : "";
    const date = parsed.data.date ? String(parsed.data.date) : "";

    // posts use tags; portfolio uses stack (but we index both into tags)
    const tags = Array.isArray(parsed.data.tags)
      ? parsed.data.tags.map(String)
      : Array.isArray(parsed.data.stack)
        ? parsed.data.stack.map(String)
        : [];

    const contentText = stripMarkdown(parsed.content);

    out.push({
      id: `${type}:${slug}`,
      type,
      slug,
      title,
      description,
      date,
      tags,
      content: contentText,
    });
  }

  return out;
}

const docs = [
  ...(await readDocsFromDir(POSTS_DIR, { type: "post" })),
  ...(await readDocsFromDir(PORTFOLIO_DIR, { type: "portfolio" })),
];

// latest first (date string sort)
docs.sort((a, b) => (a.date < b.date ? 1 : -1));

await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
await fs.writeFile(OUT_FILE, JSON.stringify({ version: 1, docs }, null, 2), "utf8");
console.log(`Wrote ${OUT_FILE} (${docs.length} docs)`);
