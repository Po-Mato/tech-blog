import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readDocsFromDir } from "./generate-search-index.mjs";

describe("generate search index", () => {
  it("serializes YAML dates to stable ISO strings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "search-index-"));
    await fs.writeFile(
      path.join(dir, "iso-date.md"),
      `---
title: Stable date
date: 2026-06-12
description: Search index date normalization
tags:
  - search
---
# Body
`,
      "utf8",
    );

    const [doc] = await readDocsFromDir(dir, { type: "post" });

    expect(doc).toMatchObject({
      slug: "iso-date",
      date: "2026-06-12T00:00:00.000Z",
    });
  });

  it("excludes draft documents from the public search index", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "search-index-"));
    await fs.writeFile(
      path.join(dir, "published.md"),
      `---
title: Published
date: 2026-06-13
---
# Visible
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "draft.md"),
      `---
title: Draft
date: 2026-06-14
draft: true
---
# Hidden
`,
      "utf8",
    );

    const docs = await readDocsFromDir(dir, { type: "post" });

    expect(docs.map((doc) => doc.slug)).toEqual(["published"]);
  });
});
