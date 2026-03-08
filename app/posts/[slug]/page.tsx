import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPostBySlug, getPostSlugs } from "../../../src/lib/posts";
import { site } from "../../../src/lib/site";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await getPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};

  const title = post.title;
  const description = post.description || site.description;
  const url = `${site.url}/posts/${post.slug}/`;

  return {
    title,
    description,
    alternates: {
      canonical: `/posts/${post.slug}/`,
    },
    openGraph: {
      type: "article",
      url,
      title,
      description,
      images: [{ url: site.ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [site.ogImage],
    },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-12 text-white md:px-8">
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/20 backdrop-blur md:p-10">
        <div className="text-sm text-white/60">{post.date}</div>
        <h1 className="mt-2 text-3xl font-semibold leading-tight md:text-5xl">{post.title}</h1>
        {post.description ? (
          <p className="mt-4 text-base text-white/75 md:text-lg">{post.description}</p>
        ) : null}

        <div
          className="prose prose-invert prose-pre:border prose-pre:border-white/10 prose-pre:bg-black/40 mt-10 max-w-none prose-headings:tracking-tight prose-p:text-white/80"
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />
      </article>
    </main>
  );
}
