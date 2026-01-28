import fs from "node:fs/promises";
import path from "node:path";

const POSTS_DIR = path.join(process.cwd(), "content", "posts");
const OUT_FILE = path.join(process.cwd(), "public", "search-index.json");

function stripFrontmatter(raw) {
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "");
}

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

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { data: {}, body: raw };

  const fm = match[1];
  const body = raw.slice(match[0].length);
  const data = {};

  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    // super-minimal parsing (string or [a,b] style)
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1);
      data[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else {
      data[key] = value.replace(/^"|"$/g, "");
    }
  }

  return { data, body };
}

const files = (await fs.readdir(POSTS_DIR)).filter((f) => /\.(md|mdx)$/i.test(f));

const docs = [];
for (const f of files) {
  const slug = f.replace(/\.(md|mdx)$/i, "");
  const raw = await fs.readFile(path.join(POSTS_DIR, f), "utf8");
  const { data, body } = parseFrontmatter(raw);

  const title = data.title || slug;
  const description = data.description || "";
  const date = data.date || "";
  const tags = Array.isArray(data.tags) ? data.tags : [];

  const contentText = stripMarkdown(stripFrontmatter(raw));

  docs.push({
    id: slug,
    slug,
    title,
    description,
    date,
    tags,
    content: contentText,
  });
}

// latest first (date string sort)
docs.sort((a, b) => (a.date < b.date ? 1 : -1));

await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
await fs.writeFile(OUT_FILE, JSON.stringify({ version: 1, docs }, null, 2), "utf8");
console.log(`Wrote ${OUT_FILE} (${docs.length} docs)`);
