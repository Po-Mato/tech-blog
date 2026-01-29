import type { MetadataRoute } from "next";

import { getPostSlugs, getPostBySlug } from "../src/lib/posts";
import { getPortfolioSlugs, getPortfolioBySlug } from "../src/lib/portfolio";
import { site } from "../src/lib/site";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const postSlugs = await getPostSlugs();
  const portfolioSlugs = await getPortfolioSlugs();

  const posts = await Promise.all(
    postSlugs.map(async (slug) => {
      const post = await getPostBySlug(slug);
      return {
        slug,
        date: post?.date || "",
      };
    })
  );

  const portfolio = await Promise.all(
    portfolioSlugs.map(async (slug) => {
      const item = await getPortfolioBySlug(slug);
      return {
        slug,
        date: item?.date || "",
      };
    })
  );

  return [
    {
      url: site.url,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 1,
    },
    {
      url: `${site.url}/portfolio/`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${site.url}/search/`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.4,
    },
    {
      url: `${site.url}/tags/`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    },
    ...posts.map((p) => ({
      url: `${site.url}/posts/${p.slug}/`,
      lastModified: p.date ? new Date(p.date) : new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...portfolio.map((p) => ({
      url: `${site.url}/portfolio/${p.slug}/`,
      lastModified: p.date ? new Date(p.date) : new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
