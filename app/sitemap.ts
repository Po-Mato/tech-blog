import type { MetadataRoute } from "next";

import { getPostSlugs, getPostBySlug } from "../src/lib/posts";
import { getPortfolioSlugs, getPortfolioBySlug } from "../src/lib/portfolio";
import { buildSitemap } from "../src/lib/sitemap";
import { getAllTags } from "../src/lib/tags";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const postSlugs = await getPostSlugs();
  const portfolioSlugs = await getPortfolioSlugs();
  const tags = await getAllTags();

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

  return buildSitemap({ posts, portfolio, tags });
}
