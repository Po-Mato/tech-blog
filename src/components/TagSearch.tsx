'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';
import { filterTagNames } from '../lib/tag-search';

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

type TagEntry = { tag: string; count: number; href: string };

export default function TagSearch({ tags }: { tags: TagEntry[] }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const matches = filterTagNames(tags, query);

  return (
    <section aria-label="태그 찾기">
      <div hidden={!ready} className="mb-6">
        <label htmlFor="tag-name-query" className="block text-sm font-medium text-white/85">태그 이름 검색</label>
        <div className="mt-2 flex gap-2">
          <input id="tag-name-query" ref={input} type="search" value={query}
            onChange={event => setQuery(event.target.value)} aria-controls="tag-results" aria-describedby="tag-search-help"
            placeholder="예: cloud, TypeScript, CI/CD"
            className="min-w-0 flex-1 rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-white focus-visible:outline-2 focus-visible:outline-cyan-200" />
          <button type="button" onClick={() => { setQuery(''); input.current?.focus(); }}
            className="shrink-0 rounded-xl border border-white/20 px-4 py-3 text-sm text-cyan-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">초기화</button>
        </div>
        <p id="tag-search-help" className="mt-2 text-sm text-white/60">태그 이름 일부를 입력해 관심 주제를 찾아보세요.</p>
      </div>
      <p role="status" aria-atomic="true" className="mb-4 text-sm text-white/70">전체 {tags.length}개 중 {matches.length}개</p>
      {matches.length === 0 ? <p className="mb-4 rounded-xl border border-white/15 p-5 text-white/80">일치하는 태그가 없습니다. 검색어를 바꾸거나 초기화해 주세요.</p> : null}
      <ul id="tag-results" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map(({ tag, count, href }) => (
          <li key={tag} className="min-w-0">
            <Link href={href} prefetch={false}
              className="flex h-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 hover:border-cyan-300/35 hover:bg-black/35 focus-visible:outline-2 focus-visible:outline-cyan-200">
              <span className="min-w-0 text-white/85 [overflow-wrap:anywhere]">#{tag}</span>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/65">{count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
