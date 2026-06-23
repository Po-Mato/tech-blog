import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getPortfolioSlugs } from "./portfolio";

describe("portfolio utilities", () => {
  it("excludes draft portfolio items from public slugs", async () => {
    const slug = `draft-portfolio-${process.pid}`;
    const filePath = path.join(process.cwd(), "content", "portfolio", `${slug}.md`);
    let slugs: string[] = [];

    await fs.writeFile(
      filePath,
      `---
title: Draft portfolio
date: 2026-06
draft: true
---
# Hidden
`,
      "utf8",
    );

    try {
      slugs = await getPortfolioSlugs();
    } finally {
      await fs.unlink(filePath);
    }

    expect(slugs).not.toContain(slug);
  });
});
