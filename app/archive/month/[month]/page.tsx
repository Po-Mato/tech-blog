import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPosts } from '../../../../src/lib/posts';
import { groupByMonth, monthHref, monthLabel } from '../../../../src/lib/month-archive';
import PostList from '../../../../src/components/PostList';
export const dynamicParams = false;
export async function generateStaticParams() { return groupByMonth(await getAllPosts()).map(g=>({month:g.month})); }
export async function generateMetadata({params}:{params:Promise<{month:string}>}):Promise<Metadata> {
  const {month}=await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();
  return {title:`${monthLabel(month)} 글`,description:`${monthLabel(month)}에 발행한 글을 최신순으로 읽어보세요.`,alternates:{canonical:monthHref(month)}};
}
export default async function MonthPage({params}:{params:Promise<{month:string}>}) {
  const {month}=await params;
  const groups=groupByMonth(await getAllPosts());
  const group=groups.find(g=>g.month===month);
  if (!group) notFound();
  return <main className="mx-auto max-w-5xl px-5 pb-20 pt-10 text-white md:px-8">
    <nav aria-label="글 목록 이동" className="flex flex-wrap gap-5 text-cyan-200"><Link href="/archive/month/">← 다른 월 보기</Link><Link href="/">전체 최신순</Link></nav>
    <h1 className="mt-6 text-3xl font-semibold">{monthLabel(month)} 글</h1>
    <p className="mb-8 mt-3 border-b border-white/15 pb-6 text-white/65">{group.posts.length}편 · 최신순</p>
    <PostList posts={group.posts}/>
  </main>;
}
