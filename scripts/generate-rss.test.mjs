import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRss, parsePostItem, readPostItems } from "./generate-rss.mjs";

describe("generate rss", () => {
  it("parses folded YAML frontmatter descriptions", () => {
    const item = parsePostItem(
      "rss-frontmatter.mdx",
      `---
title: "RSS: 안정성 개선"
date: 2026-06-11
description: >
  첫 줄: YAML 접힘
  둘째 줄 & 검색
---
# 본문
`
    );

    expect(item).toMatchObject({
      slug: "rss-frontmatter",
      title: "RSS: 안정성 개선",
      date: "2026-06-11T00:00:00.000Z",
    });
    expect(item.description).toContain("첫 줄: YAML 접힘 둘째 줄 & 검색");

    const rss = buildRss([item], {
      lastBuildDate: new Date("2026-06-11T00:00:00.000Z"),
    });

    expect(rss).toContain("<title>RSS: 안정성 개선</title>");
    expect(rss).toContain("첫 줄: YAML 접힘 둘째 줄 &amp; 검색");
    expect(rss).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(rss).toContain('<atom:link href="https://po-mato.github.io/rss.xml" rel="self" type="application/rss+xml" />');
    expect(rss).not.toContain("<description>&gt;</description>");
  });

  it("excludes draft posts from the public feed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rss-posts-"));
    await fs.writeFile(
      path.join(dir, "published.md"),
      `---
title: Published
date: 2026-06-18
---
# Visible
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "draft.md"),
      `---
title: Draft
date: 2026-06-19
draft: true
---
# Hidden
`,
      "utf8",
    );

    const items = await readPostItems(dir);

    expect(items.map((item) => item.slug)).toEqual(["published"]);
  });

  it("uses frontmatter slug values for item links", () => {
    const item = parsePostItem(
      "rss-source.md",
      `---
title: RSS custom slug
slug: rss-public
date: 2026-06-24
---
# Body
`,
    );

    expect(item).toMatchObject({
      slug: "rss-public",
      link: "https://po-mato.github.io/posts/rss-public/",
    });
  });
});
