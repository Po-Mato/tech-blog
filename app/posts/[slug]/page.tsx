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
    <main className="mx-auto max-w-4xl px-5 pb-20 pt-8 text-white md:px-8">
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/20 backdrop-blur transition duration-500 hover:border-cyan-300/30 hover:shadow-cyan-900/30 md:p-10">
        <div className="text-sm text-white/60">{post.date}</div>
        <h1 className="mt-2 text-3xl font-bold leading-snug md:text-5xl">
          {post.title}
        </h1>
        {post.description ? (
          <p className="mt-4 text-base text-white/80 md:text-lg">{post.description}</p>
        ) : null}

        <div
          className="prose prose-invert mt-10 max-w-none prose-headings:tracking-tight prose-p:text-white/80 prose-a:text-cyan-300 prose-a:transition prose-a:hover:text-cyan-100 prose-li:marker:text-cyan-300"
          // content는 로컬 markdown에서 생성되며, rehype-sanitize로 최소한의 HTML 정리를 거칩니다.
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />
      </article>
    </main>
  );
}
