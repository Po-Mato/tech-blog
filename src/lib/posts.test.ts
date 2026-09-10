import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let fixtureRoot: string;
let postsDirectory: string;
let getPostBySlug: typeof import("./posts").getPostBySlug;
let getPostSlugs: typeof import("./posts").getPostSlugs;

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "blog-post-fixtures-"));
  postsDirectory = path.join(fixtureRoot, "content", "posts");
  await fs.mkdir(postsDirectory, { recursive: true });
  // The module captures its content directory at import time. Never mutate the
  // repository's posts while other test files are reading them in parallel.
  vi.resetModules();
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);
  try {
    ({ getPostBySlug, getPostSlugs } = await import("./posts"));
  } finally {
    cwd.mockRestore();
  }
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("post utilities", () => {
  it("excludes draft posts from public slugs", async () => {
    const slug = `draft-post-${process.pid}`;
    const filePath = path.join(postsDirectory, `${slug}.md`);
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
    const filePath = path.join(postsDirectory, `${fileSlug}.md`);
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
