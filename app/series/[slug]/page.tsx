import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { series, selectPosts } from '../../../src/lib/editorial';
import { getAllPosts } from '../../../src/lib/posts';
import { formatDate } from '../../../src/lib/content/metadata.mjs';
export const dynamicParams = false;
export function generateStaticParams() {
  return series.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = series.find((item) => item.slug === slug);
  return item
    ? {
        title: item.title,
        description: item.description,
        alternates: { canonical: `/series/${slug}/` },
      }
    : {};
}
export default async function SeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = series.find((item) => item.slug === slug);
  if (!item) notFound();
  const posts = selectPosts(await getAllPosts(), item.slugs);
  return (
    <main className="mx-auto max-w-4xl px-5 pb-20 pt-10 text-white md:px-8">
      <Link className="text-sm text-cyan-200" href="/series/">
        ← 모든 시리즈
      </Link>
      <h1 className="mt-6 text-3xl font-semibold md:text-4xl">{item.title}</h1>
      <p className="mt-4 text-white/65">{item.description}</p>
      <ol className="mt-10 divide-y divide-white/15">
        {posts.map((post, index) => (
          <li key={post.slug} className="grid grid-cols-[2rem_1fr] gap-4 py-7">
            <span className="font-mono text-cyan-200">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h2 className="text-xl font-semibold">
                <Link className="hover:text-cyan-200" href={`/posts/${post.slug}/`}>
                  {post.title}
                </Link>
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/65">{post.description}</p>
              <time className="mt-3 block font-mono text-xs text-white/45" dateTime={post.date}>
                {formatDate(post.date)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
