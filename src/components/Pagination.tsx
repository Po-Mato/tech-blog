import Link from 'next/link';
import { pageHref } from '../lib/editorial';

export default function Pagination({ current, total }: { current: number; total: number }) {
  if (total <= 1) return null;
  const pages = Array.from({ length: total }, (_, i) => i + 1).filter(
    (page) => page === 1 || page === total || Math.abs(page - current) <= 1,
  );
  const style =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/15 px-3 text-sm hover:border-cyan-200/60 hover:text-cyan-100';
  return (
    <nav
      aria-label="글 목록 페이지"
      className="mt-8 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-8"
    >
      {current > 1 ? (
        <Link rel="prev" className={style} href={pageHref(current - 1)}>
          이전
        </Link>
      ) : null}
      {pages.map((page, index) => (
        <span key={page} className="flex items-center gap-2">
          {index > 0 && page - pages[index - 1] > 1 ? (
            <span aria-hidden="true" className="px-1 text-white/40">
              …
            </span>
          ) : null}
          <Link
            aria-label={`${page}페이지`}
            aria-current={page === current ? 'page' : undefined}
            className={`${style} ${page === current ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'text-white/70'}`}
            href={pageHref(page)}
          >
            {page}
          </Link>
        </span>
      ))}
      {current < total ? (
        <Link rel="next" className={style} href={pageHref(current + 1)}>
          다음
        </Link>
      ) : null}
    </nav>
  );
}
