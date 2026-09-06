import Link from 'next/link';
import type { Metadata } from 'next';
import { series } from '../../src/lib/editorial';
export const metadata: Metadata = {
  title: '시리즈',
  description: '메모리 설계, 운영 신뢰성, 에이전트 기반 개발을 순서대로 읽어보세요.',
  alternates: { canonical: '/series/' },
};
export default function SeriesPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 pb-20 pt-10 text-white md:px-8">
      <h1 className="text-4xl font-semibold">주제를 따라 읽는 시리즈</h1>
      <p className="mt-4 text-white/65">
        서로 연결되는 글을 기초부터 응용까지 읽기 순서로 묶었습니다.
      </p>
      <ul className="mt-10 divide-y divide-white/15">
        {series.map((item) => (
          <li key={item.slug} className="py-8">
            <p className="text-sm text-cyan-200">{item.slugs.length}편</p>
            <h2 className="mt-3 text-2xl font-semibold">
              <Link href={`/series/${item.slug}/`} className="hover:text-cyan-200">
                {item.title} ↗
              </Link>
            </h2>
            <p className="mt-3 text-white/65">{item.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
