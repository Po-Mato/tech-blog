import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import matter from "gray-matter";

const SITE_URL = "https://po-mato.github.io";
const OUT_DIR = path.join(process.cwd(), "out");
const POSTS_DIR = path.join(process.cwd(), "content", "posts");

export function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function frontmatterString(value, fallback = "") {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function parsePostItem(filename, raw) {
  const fallbackSlug = filename.replace(/\.(md|mdx)$/i, "");
  const { data } = matter(raw);

  const slug = frontmatterString(data.slug, fallbackSlug);
  const title = frontmatterString(data.title, slug);
  const date = frontmatterString(data.date, new Date().toISOString());
  const description = frontmatterString(data.description);
  const link = `${SITE_URL}/posts/${slug}/`;

  return {
    title,
    date,
    description,
    link,
    slug,
    draft: data.draft === true,
  };
}

export async function readPostItems(postsDir = POSTS_DIR) {
  const files = (await fs.readdir(postsDir)).filter((f) => /\.(md|mdx)$/i.test(f));
  const items = [];

  for (const f of files) {
    const raw = await fs.readFile(path.join(postsDir, f), "utf8");
    const item = parsePostItem(f, raw);
    if (!item.draft) items.push(item);
  }

  return items.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function buildRss(items, { lastBuildDate = new Date() } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml("Mato Po Tech Blog")}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeXml("개발하면서 배운 것과 삽질 로그를 기록합니다.")}</description>
    <language>ko</language>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>
${items
  .map(
    (it) => `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${it.link}</link>
      <guid>${it.link}</guid>
      <pubDate>${new Date(it.date).toUTCString()}</pubDate>
      ${it.description ? `<description>${escapeXml(it.description)}</description>` : ""}
    </item>`
  )
  .join("\n")}
  </channel>
</rss>
`;
}

export async function generateRss({ postsDir = POSTS_DIR, outDir = OUT_DIR } = {}) {
  const items = await readPostItems(postsDir);
  const rss = buildRss(items);

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "rss.xml"), rss, "utf8");
  console.log("Wrote out/rss.xml");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateRss();
}
