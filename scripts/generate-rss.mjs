import fs from "node:fs/promises";
import path from "node:path";

const SITE_URL = "https://po-mato.github.io";
const OUT_DIR = path.join(process.cwd(), "out");
const POSTS_DIR = path.join(process.cwd(), "content", "posts");

function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseFrontmatter(raw) {
  // Minimal frontmatter parse: rely on existing gray-matter output in app.
  // Here we keep it simple to avoid extra deps.
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { data: {}, content: raw };

  const fm = match[1];
  const content = raw.slice(match[0].length);
  const data = {};

  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    data[key] = value.replace(/^"|"$/g, "");
  }

  return { data, content };
}

const files = (await fs.readdir(POSTS_DIR)).filter((f) => /\.(md|mdx)$/i.test(f));

const items = [];
for (const f of files) {
  const slug = f.replace(/\.(md|mdx)$/i, "");
  const raw = await fs.readFile(path.join(POSTS_DIR, f), "utf8");
  const { data } = parseFrontmatter(raw);

  const title = data.title || slug;
  const date = data.date || new Date().toISOString();
  const description = data.description || "";
  const link = `${SITE_URL}/posts/${slug}/`;

  items.push({ title, date, description, link, slug });
}

items.sort((a, b) => (a.date < b.date ? 1 : -1));

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml("Mato Po Tech Blog")}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeXml("개발하면서 배운 것과 삽질 로그를 기록합니다.")}</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
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

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "rss.xml"), rss, "utf8");
console.log("Wrote out/rss.xml");
