import type { Metadata } from 'next';
import Link from 'next/link';
import PostContent from '../../../src/components/PostContent';
import { formatDate } from '../../../src/lib/content/metadata.mjs';
import { series, selectPosts } from '../../../src/lib/editorial';
import { tagToSlug } from '../../../src/lib/tags';
import { notFound } from 'next/navigation';

import { getPostBySlug, getPostSlugs, getAllPosts } from '../../../src/lib/posts';
import { site } from '../../../src/lib/site';

export const dynamic = 'force-static';
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
      type: 'article',
      publishedTime: post.date,
      tags: post.tags,
      url,
      title,
      description,
      images: [{ url: site.ogImage }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [site.ogImage],
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const memberships = series.filter((item) => item.slugs.includes(post.slug));
  const posts = memberships.length ? await getAllPosts() : [];

  return (
    <main className="mx-auto max-w-4xl px-5 pb-20 pt-8 text-white md:px-8">
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/20 backdrop-blur transition duration-500 hover:border-cyan-300/30 hover:shadow-cyan-900/30 md:p-10">
        <Link href="/" className="mb-6 inline-block text-sm text-cyan-200">
          ← 블로그 홈
        </Link>
        <time dateTime={post.date} className="block font-mono text-sm text-white/60">
          {formatDate(post.date)}
        </time>
        <h1 className="mt-2 text-3xl font-bold leading-snug md:text-5xl">{post.title}</h1>
        {post.description ? (
          <p className="mt-4 text-base text-white/80 md:text-lg">{post.description}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          {post.tags?.map((tag) => (
            <Link
              key={tag}
              className="text-xs text-cyan-200 hover:underline"
              href={`/tags/${tagToSlug(tag)}/`}
            >
              #{tag}
            </Link>
          ))}
        </div>
        {post.headings.length >= 2 ? (
          <nav aria-label="이 글의 목차" className="post-toc mt-8 rounded-xl border border-cyan-200/20 bg-slate-950/60 p-5">
            <details open>
              <summary className="cursor-pointer font-semibold text-cyan-100">
                이 글의 목차 <span className="ml-2 text-sm font-normal text-white/60">{post.headings.length}개 항목</span>
              </summary>
              <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-2">
                {post.headings.map((heading) => (
                  <li key={heading.id} className={heading.depth === 3 ? 'ml-4 border-l border-white/15 pl-3' : ''}>
                    <a href={`#${encodeURIComponent(heading.id)}`} className="block rounded py-2 text-sm leading-relaxed text-white/80 hover:text-cyan-200 focus-visible:text-cyan-200">
                      {heading.title}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          </nav>
        ) : null}
        <PostContent contentHtml={post.contentHtml} />
      </article>
      {memberships.map((item) => (
        <nav
          key={item.slug}
          aria-label={`${item.title} 읽기 순서`}
          className="mt-8 border border-white/15 bg-slate-950/80 p-6"
        >
          <Link className="text-lg font-semibold text-cyan-200" href={`/series/${item.slug}/`}>
            {item.title} ↗
          </Link>
          <ol className="mt-4 space-y-3">
            {selectPosts(posts, item.slugs).map((entry, index) => (
              <li key={entry.slug} className="flex gap-3 text-sm">
                <span className="font-mono text-white/40">{index + 1}.</span>
                <Link
                  href={`/posts/${entry.slug}/`}
                  aria-current={entry.slug === post.slug ? 'page' : undefined}
                  className={
                    entry.slug === post.slug
                      ? 'font-semibold text-cyan-200'
                      : 'text-white/70 hover:text-cyan-200'
                  }
                >
                  {entry.title}
                  {entry.slug === post.slug ? ' · 읽는 중' : ''}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      ))}
    </main>
  );
}
