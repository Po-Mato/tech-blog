import { describe, expect, it } from "vitest";

import { buildSitemap } from "./sitemap";

describe("sitemap utilities", () => {
  it("includes encoded tag archive detail routes", () => {
    const sitemap = buildSitemap({
      posts: [{ slug: "post-a", date: "2026-06-13" }],
      portfolio: [],
      tags: [
        { tag: "nextjs", count: 2 },
        { tag: "프론트엔드 아키텍처", count: 1 },
      ],
      now: new Date("2026-06-13T00:00:00.000Z"),
    });

    expect(sitemap.map((entry) => entry.url)).toEqual(
      expect.arrayContaining([
        "https://po-mato.github.io/tags/nextjs/",
        "https://po-mato.github.io/tags/%ED%94%84%EB%A1%A0%ED%8A%B8%EC%97%94%EB%93%9C%20%EC%95%84%ED%82%A4%ED%85%8D%EC%B2%98/",
      ]),
    );
  });
});
