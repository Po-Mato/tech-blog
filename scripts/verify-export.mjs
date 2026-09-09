import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { validateContent } from './validate-content.mjs';
import { normalizeTags, TAG_ALIASES } from '../src/lib/content/metadata.mjs';

const posts = await validateContent();
const read = (route) => fs.readFile(`out/${route ? route + '/' : ''}index.html`, 'utf8');
// Only inspect rendered markup, not the duplicate RSC payload in script tags.
const markup = (html) =>
  html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/dateTime=/g, 'datetime=');
const home = markup(await read(''));
assert.equal(
  (home.match(/<article\b/g) || []).length,
  Math.min(10, posts.length) + 3,
  'Home must contain 3 featured and 10 latest articles',
);
assert(home.includes(`datetime="${posts[0].date}"`), 'Latest publication must appear on home');
const latestSection = home.slice(home.indexOf('aria-labelledby="latest-heading"'));
assert.equal((latestSection.match(/<article\b/g) || []).length, Math.min(10, posts.length));
let previous = -1;
for (const post of posts.slice(0, 10)) {
  const position = latestSection.indexOf(`href="/posts/${post.slug}/"`);
  assert(position > previous, 'Home posts must be in publication order');
  previous = position;
}
const sitemap = await fs.readFile('out/sitemap.xml', 'utf8');
for (let page = 2; page <= Math.ceil(posts.length / 10); page++) {
  const html = markup(await read(`archive/${page}`));
  assert.equal(
    (html.match(/<article\b/g) || []).length,
    posts.slice((page - 1) * 10, page * 10).length,
  );
  for (const post of posts.slice((page - 1) * 10, page * 10))
    assert(html.includes(`/posts/${post.slug}/`));
  assert(sitemap.includes(`/archive/${page}/`));
}
for (const post of posts) {
  const html = markup(await read(`posts/${post.slug}`));
  assert(html.includes(`datetime="${post.date}"`), `${post.slug}: publication date missing`);
  const sectionIds = [...html.matchAll(/<h[23]\b[^>]*\bid="(section-[^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(sectionIds).size, sectionIds.length, `${post.slug}: duplicate section IDs`);
  const toc = html.match(/<nav aria-label="이 글의 목차"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.equal(Boolean(toc), sectionIds.length >= 2, `${post.slug}: table of contents visibility`);
  for (const id of sectionIds) {
    const href = `href="#${encodeURIComponent(id)}"`;
    assert(html.includes(href), `${post.slug}: section permalink missing`);
    if (toc) assert(toc.includes(href), `${post.slug}: section missing from table of contents`);
  }
}
for (const slug of ['agent-memory', 'agent-reliability', 'agent-development']) {
  const html = markup(await read(`series/${slug}`));
  assert(html.includes('<ol'), `${slug}: reading order missing`);
  assert(sitemap.includes(`/series/${slug}/`));
}
const tags = new Set(posts.flatMap((post) => normalizeTags(post.tags)));
for (const tag of tags) {
  const html = markup(await read(`tags/${tag.replaceAll("/", "%2F")}`));
  if (tag.includes('/')) {
    assert.equal(markup(await read(`tags/${tag}`)), html, `${tag}: GitHub Pages decoded path missing`);
  }
  const expected = posts.filter((post) => normalizeTags(post.tags).includes(tag));
  for (const post of expected)
    assert(html.includes(`/posts/${post.slug}/`), `${tag}: missing ${post.slug}`);
  assert(
    html.includes(
      `rel="canonical" href="https://po-mato.github.io/tags/${encodeURIComponent(tag)}/"`,
    ),
    `${tag}: invalid canonical`,
  );
}
for (const [alias, canonical] of Object.entries(TAG_ALIASES)) {
  if (!tags.has(canonical)) continue;
  // Filesystem segments use the raw tag name; href values are URL-encoded.
  const html = await read(`tags/${alias.replaceAll("/", "%2F")}`);
  assert(
    html.includes(
      `rel="canonical" href="https://po-mato.github.io/tags/${encodeURIComponent(canonical)}/"`,
    ),
  );
}
const index = JSON.parse(await fs.readFile('out/search-index.json', 'utf8')).docs.filter(
  (doc) => doc.type === 'post',
);
assert.equal(index.length, posts.length);
assert.equal(index[0].slug, posts[0].slug);
for (const doc of index) {
  const post = posts.find((post) => post.slug === doc.slug);
  assert.equal(doc.date, post.date);
  assert.deepEqual(doc.tags, normalizeTags(post.tags));
}
const rss = await fs.readFile('out/rss.xml', 'utf8');
assert.equal((rss.match(/<item>/g) || []).length, posts.length);
assert(
  rss.slice(rss.indexOf('<item>'), rss.indexOf('</item>')).includes(`/posts/${posts[0].slug}/`),
);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await fs.writeFile(
  'out/build-info.json',
  JSON.stringify(
    {
      sourceCommit,
      postCount: posts.length,
      latestPost: posts[0].slug,
      latestDate: posts[0].date,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Export verified: home, all archive pages, all post dates, series, legacy tag canonicals, search, RSS, sitemap.',
);
