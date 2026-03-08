import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./posts", () => ({
  getAllPosts: vi.fn(),
}));

import { getAllPosts, type PostMeta } from "./posts";
import { getAllTags, normalizeTag, slugToTag, tagToSlug } from "./tags";

const mockedGetAllPosts = vi.mocked(getAllPosts);

describe("tags utilities", () => {
  beforeEach(() => {
    mockedGetAllPosts.mockReset();
  });

  it("normalizeTag trims whitespace", () => {
    expect(normalizeTag("  nextjs  ")).toBe("nextjs");
  });

  it("tag slug conversion is reversible for unicode and spaces", () => {
    const original = "프론트엔드 아키텍처";
    const slug = tagToSlug(original);

    expect(slug).not.toBe(original);
    expect(slugToTag(slug)).toBe(original);
  });

  it("getAllTags aggregates and sorts by count desc, then name asc", async () => {
    const posts: PostMeta[] = [
      {
        slug: "a",
        title: "a",
        date: "2026-03-01",
        tags: ["react", " nextjs ", "react"],
      },
      {
        slug: "b",
        title: "b",
        date: "2026-03-02",
        tags: ["nextjs", "typescript"],
      },
      {
        slug: "c",
        title: "c",
        date: "2026-03-03",
        tags: ["typescript"],
      },
    ];

    mockedGetAllPosts.mockResolvedValue(posts);

    await expect(getAllTags()).resolves.toEqual([
      { tag: "nextjs", count: 2 },
      { tag: "react", count: 2 },
      { tag: "typescript", count: 2 },
    ]);
  });
});
