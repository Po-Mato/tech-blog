import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getPostSlugs } from "./posts";

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
});
