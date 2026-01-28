import type { MetadataRoute } from "next";

import { getPostSlugs, getPostBySlug } from "../src/lib/posts";
import { site } from "../src/lib/site";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getPostSlugs();

  const posts = await Promise.all(
    slugs.map(async (slug) => {
      const post = await getPostBySlug(slug);
      return {
        slug,
        date: post?.date || "",
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
    ...posts.map((p) => ({
      url: `${site.url}/posts/${p.slug}/`,
      lastModified: p.date ? new Date(p.date) : new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
