import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllPosts } from '../../../src/lib/posts';
import { groupByMonth, monthHref, monthLabel } from '../../../src/lib/month-archive';
export const metadata: Metadata = { title: '월별 지난 글', description: '발행 월과 글 수를 보고 지난 글을 찾아보세요.', alternates: {canonical: '/archive/month/'} };
export default async function MonthIndex() {
  const groups = groupByMonth(await getAllPosts());
  return <main className="mx-auto max-w-5xl px-5 pb-20 pt-10 text-white md:px-8">
    <Link href="/" className="text-cyan-200">← 전체 최신순</Link>
    <h1 className="mt-6 text-3xl font-semibold">월별 지난 글</h1>
    <p className="mt-3 text-white/65">발행 월을 선택해 그때의 글을 찾아보세요. 전체 {groups.reduce((n,g)=>n+g.posts.length,0)}편</p>
    <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(g=><li key={g.month}><Link className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-white/15 p-5 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-cyan-200" href={monthHref(g.month)}><span>{monthLabel(g.month)}</span><span className="text-cyan-200">{g.posts.length}편</span></Link></li>)}
    </ul>
    {!groups.length && <p className="mt-8">아직 글이 없습니다.</p>}
  </main>;
}
