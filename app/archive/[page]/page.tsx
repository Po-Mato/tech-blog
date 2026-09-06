import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAllPosts } from '../../../src/lib/posts';
import { pageCount, pageHref, postsOnPage } from '../../../src/lib/editorial';
import PostList from '../../../src/components/PostList';
import Pagination from '../../../src/components/Pagination';

export const dynamicParams = false;
export async function generateStaticParams() {
  return Array.from({ length: pageCount((await getAllPosts()).length) - 1 }, (_, i) => ({
    page: String(i + 2),
  }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  return {
    title: `글 목록 · ${page}페이지`,
    description: `블로그의 지난 글을 최신순으로 읽어보세요. ${page}페이지.`,
    alternates: { canonical: pageHref(Number(page)) },
  };
}
export default async function ArchivePage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const posts = await getAllPosts();
  const current = Number(page);
  if (!/^\d+$/.test(page) || current < 2 || current > pageCount(posts.length)) notFound();
  return (
    <main className="mx-auto max-w-5xl px-5 pb-20 pt-10 text-white md:px-8">
      <header className="mb-10 border-b border-white/15 pb-8">
        <Link href="/" className="text-sm text-cyan-200">
          ← 블로그 홈
        </Link>
        <h1 className="mt-5 text-3xl font-semibold">지난 글</h1>
        <p className="mt-3 text-white/60">
          전체 {posts.length}편 · {current} / {pageCount(posts.length)}페이지
        </p>
      </header>
      <PostList posts={postsOnPage(posts, current)} />
      <Pagination current={current} total={pageCount(posts.length)} />
    </main>
  );
}
