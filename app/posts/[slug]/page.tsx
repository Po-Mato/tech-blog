import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPostBySlug, getPostSlugs } from "../../../src/lib/posts";
import { site } from "../../../src/lib/site";

export async function generateStaticParams() {
  const slugs = await getPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
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

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <article className="rounded-xl border border-white/10 bg-black/30 p-8 backdrop-blur">
        <div className="text-sm text-white/60">{post.date}</div>
        <h1 className="mt-2 text-4xl font-bold">{post.title}</h1>
        {post.description ? (
          <p className="mt-3 text-white/80">{post.description}</p>
        ) : null}

        <div
          className="prose prose-invert mt-8 max-w-none"
          // content는 로컬 markdown에서 생성되며, rehype-sanitize로 최소한의 HTML 정리를 거칩니다.
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />
      </article>
    </main>
  );
}
