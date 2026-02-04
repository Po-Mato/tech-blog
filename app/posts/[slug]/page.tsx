import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPostBySlug, getPostSlugs } from "../../../src/lib/posts";
import { site } from "../../../src/lib/site";

// 정적 호스팅(GitHub Pages + output: export)에서는
// 동적 라우트도 강제로 정적 생성되도록 지정해야 안전합니다.
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
    <main 
      id="main-content" 
      className="mx-auto max-w-3xl p-10 text-white"
      role="main"
    >
      <article 
        className="
          rounded-xl 
          border 
          border-white/10 
          bg-black/30 
          p-8 
          backdrop-blur
          hover:border-white/15
          transition-all
          duration-300
        "
        itemScope 
        itemType="https://schema.org/BlogPosting"
      >
        <header>
          <time 
            dateTime={post.date} 
            className="text-sm text-white/60"
            itemProp="datePublished"
          >
            {post.date}
          </time>
          <h1 
            className="mt-2 text-4xl font-bold leading-tight"
            itemProp="headline"
          >
            {post.title}
          </h1>
          {post.description ? (
            <p 
              className="mt-3 text-white/80 leading-relaxed"
              itemProp="description"
            >
              {post.description}
            </p>
          ) : null}
        </header>

        <div
          className="prose prose-invert mt-8 max-w-none"
          itemProp="articleBody"
          // content는 로컬 markdown에서 생성되며, rehype-sanitize로 최소한의 HTML 정리를 거칩니다.
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />
      </article>
    </main>
  );
}
