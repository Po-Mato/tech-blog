import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getPostBySlug, getPostSlugs } from "./posts";

describe("post utilities", () => {
  it("excludes draft posts from public slugs", async () => {
    const slug = `draft-post-${process.pid}`;
    const filePath = path.join(process.cwd(), "content", "posts", `${slug}.md`);
    let slugs: string[] = [];

    await fs.writeFile(
      filePath,
      `---
title: Draft post
date: 2026-06-20
draft: true
---
# Hidden
`,
      "utf8",
    );

    try {
      slugs = await getPostSlugs();
    } finally {
      await fs.unlink(filePath);
    }

    expect(slugs).not.toContain(slug);
  });

  it("uses frontmatter slug values for public post routes", async () => {
    const fileSlug = `custom-slug-source-${process.pid}`;
    const publicSlug = `custom-slug-public-${process.pid}`;
    const filePath = path.join(process.cwd(), "content", "posts", `${fileSlug}.md`);
    let slugs: string[] = [];

    await fs.writeFile(
      filePath,
      `---
title: Custom slug post
slug: ${publicSlug}
date: 2026-06-24
---
# Visible
`,
      "utf8",
    );

    try {
      slugs = await getPostSlugs();
      const post = await getPostBySlug(publicSlug);

      expect(slugs).toContain(publicSlug);
      expect(slugs).not.toContain(fileSlug);
      expect(post).toMatchObject({
        slug: publicSlug,
        title: "Custom slug post",
      });
    } finally {
      await fs.unlink(filePath);
    }
  });
});
