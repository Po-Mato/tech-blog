import type { MetadataRoute } from "next";

import { site } from "./site";
import { tagToSlug, type TagCount } from "./tags";

type SitemapContentItem = {
  slug: string;
  date: string;
};

export function buildSitemap({
  posts,
  portfolio,
  tags,
  now = new Date(),
}: {
  posts: SitemapContentItem[];
  portfolio: SitemapContentItem[];
  tags: TagCount[];
  now?: Date;
}): MetadataRoute.Sitemap {
  return [
    {
      url: site.url,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 1,
    },
    {
      url: `${site.url}/portfolio/`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${site.url}/search/`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    },
    {
      url: `${site.url}/tags/`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    },
    ...tags.map(({ tag }) => ({
      url: `${site.url}/tags/${tagToSlug(tag)}/`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
    ...posts.map((p) => ({
      url: `${site.url}/posts/${p.slug}/`,
      lastModified: p.date ? new Date(p.date) : now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...portfolio.map((p) => ({
      url: `${site.url}/portfolio/${p.slug}/`,
      lastModified: p.date ? new Date(p.date) : now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
