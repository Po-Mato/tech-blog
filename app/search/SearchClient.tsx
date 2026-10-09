'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { readSearchConditions, updateSearchUrl, type SearchConditions } from '../../src/lib/search-url';
import MiniSearch from 'minisearch';
import { createSearchLoader, type SearchDoc, type SearchLoadState } from '../../src/lib/search-loader';
import { formatDate } from '../../src/lib/content/metadata.mjs';

import { getQueryTerms, highlightHtml } from '../../src/lib/search-highlight';

function buildSnippet(content: string, q: string, maxLen = 180): string {
  const terms = getQueryTerms(q);
  if (!terms.length) return content.slice(0, maxLen);

  const lower = content.toLowerCase();
  const idx = terms
    .map((t) => lower.indexOf(t.toLowerCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];

  const start = Math.max(0, (idx ?? 0) - 40);
  const snippet = content.slice(start, start + maxLen);
  return (start > 0 ? '…' : '') + snippet + (start + maxLen < content.length ? '…' : '');
}

const EMPTY_DOCS: SearchDoc[] = [];

function buildMiniSearch(docs: SearchDoc[]) {
  const miniSearch = new MiniSearch<SearchDoc>({
    fields: ['title', 'description', 'tags', 'content'],
    storeFields: ['type', 'slug', 'title', 'description', 'date', 'tags'],
    searchOptions: {
      boost: { title: 5, tags: 3, description: 2, content: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  miniSearch.addAll(docs);
  return miniSearch;
}

function subscribeSearchUrl(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener('blog-search-change', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('blog-search-change', listener);
  };
}
const subscribeHydration = () => () => {};
const getHydrated = () => true;
const getServerHydrated = () => false;
const getSearchSnapshot = () => window.location.search;

export default function SearchClient() {
  const queryInput = useRef<HTMLInputElement>(null);
  const hydrated = useSyncExternalStore(subscribeHydration, getHydrated, getServerHydrated);
  const routeParams = useSearchParams();
  const search = useSyncExternalStore(subscribeSearchUrl, getSearchSnapshot, () => routeParams.toString());
  const searchParams = new URLSearchParams(search);
  const retryButton = useRef<HTMLButtonElement>(null);
  const loader = useRef<ReturnType<typeof createSearchLoader> | null>(null);
  const [loadState, setLoadState] = useState<SearchLoadState>({ status: 'loading', canRetry: false });
  const loading = loadState.status === 'loading';
  const loadError = loadState.status === 'error';
  const docs = loadState.status === 'ready' ? loadState.docs : EMPTY_DOCS;

  useEffect(() => {
    const request = createSearchLoader(state => {
      if (state.status === 'ready' && retryButton.current && document.activeElement === retryButton.current) {
        queryInput.current?.focus();
      }
      setLoadState(state);
    });
    loader.current = request;
    void request.start();
    return () => {
      request.dispose();
      if (loader.current === request) loader.current = null;
    };
  }, []);

  const miniSearch = useMemo(() => buildMiniSearch(docs), [docs]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) for (const t of d.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [docs]);

  const availableTags = loading || loadError ? undefined : allTags;
  const { q, tag: tagFilter, sort: sortMode } = readSearchConditions(searchParams, availableTags);

  function changeConditions(patch: Partial<SearchConditions>, push = false) {
    // Read the live URL so rapid edits cannot overwrite one another with stale render state.
    const next = updateSearchUrl(window.location.href, patch, availableTags);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next === current) return;
    if (push) window.history.pushState(null, '', next);
    else window.history.replaceState(null, '', next);
    window.dispatchEvent(new Event('blog-search-change'));
  }

  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return [];

    let rows = miniSearch.search(query, { combineWith: 'AND' });

    if (tagFilter !== 'all') {
      rows = rows.filter((r) => (r.tags ?? []).includes(tagFilter));
    }

    if (sortMode === 'new') {
      rows = [...rows].sort((a, b) => {
        const ad = a.date ? Date.parse(a.date) : 0;
        const bd = b.date ? Date.parse(b.date) : 0;
        return bd - ad;
      });
    }

    return rows;
  }, [miniSearch, q, sortMode, tagFilter]);

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-white md:px-8">
      <header className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur transition duration-300 hover:border-cyan-300/30">
        <p className="text-xs font-medium tracking-[0.22em] text-cyan-200/80">SEARCH</p>
        <h1 className="mt-2 text-4xl font-bold">통합 검색</h1>
        <p className="mt-3 text-white/75">제목/설명/태그/본문 전체에서 검색합니다.</p>
      </header>

      <div className="mb-7 space-y-3">
        <input
          ref={queryInput}
          aria-label="검색어"
          disabled={!hydrated}
          value={q}
          onChange={(e) => changeConditions({ q: e.target.value })}
          placeholder="예: nextjs, threejs, i18n ..."
          className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-white/40 outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-300/20"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-white/70">
            태그
            <select
              aria-label="태그 필터"
              disabled={loading || loadError}
              value={tagFilter}
              onChange={(e) => changeConditions({ tag: e.target.value }, true)}
              className="ml-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-white transition duration-200 focus:border-cyan-300/40"
            >
              <option value="all">전체</option>
              {(loading || loadError) && tagFilter !== 'all' ? (
                <option value={tagFilter}>#{tagFilter}</option>
              ) : null}
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-white/70">
            정렬
            <select
              aria-label="정렬 방식"
              disabled={!hydrated}
              value={sortMode}
              onChange={(e) => changeConditions({ sort: e.target.value === 'new' ? 'new' : 'relevance' }, true)}
              className="ml-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-white transition duration-200 focus:border-cyan-300/40"
            >
              <option value="relevance">관련도</option>
              <option value="new">최신순</option>
            </select>
          </label>
        </div>
      </div>

      {loading || loadError ? (
        <div data-search-load className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p role={loadError ? 'alert' : 'status'} className="text-white/80">
            {loading ? '검색 자료를 불러오는 중입니다…' : '검색 자료를 불러오지 못했습니다. 검색 조건은 유지됩니다. 다시 시도해 주세요.'}
          </p>
          {loadState.canRetry ? (
            <button ref={retryButton} type="button" data-search-retry
              aria-disabled={loading} aria-busy={loading}
              onClick={() => { void loader.current?.start(); }}
              className="mt-4 min-h-11 rounded-xl border border-cyan-200/30 px-4 py-2 text-cyan-100 aria-disabled:opacity-60">
              {loading ? '다시 불러오는 중…' : '다시 시도'}
            </button>
          ) : null}
        </div>
      ) : !q.trim() ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">검색어를 입력해줘.</p>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p role="status" className="text-white/80">검색 결과가 없어요.</p>
          <p className="mt-2 text-sm text-white/60">검색어를 수정하거나 다른 주제에서 글을 찾아보세요.</p>
          <div aria-label="검색 탐색 도움" className="mt-4 flex flex-wrap gap-3">
            {tagFilter !== 'all' ? (
              <button type="button" onClick={() => {
                changeConditions({ tag: 'all' }, true);
                queryInput.current?.focus();
              }} className="min-h-11 rounded-xl border border-cyan-300/40 px-4 py-3 text-sm text-cyan-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">
                태그 해제하고 다시 찾기
              </button>
            ) : null}
            <button type="button" onClick={() => queryInput.current?.focus()}
              className="min-h-11 rounded-xl border border-white/20 px-4 py-3 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">
              검색어 수정
            </button>
            <Link href="/tags/" className="min-h-11 rounded-xl border border-white/20 px-4 py-3 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">
              주제 목록 보기
            </Link>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {results.map((r) => (
            <li
              key={r.id}
              className="min-w-0 rounded-2xl border border-white/10 bg-black/30 p-6 [overflow-wrap:anywhere] backdrop-blur transition duration-300 hover:border-cyan-300/30 hover:bg-black/35"
            >
              {r.date ? (
                <time dateTime={r.date} className="font-mono text-sm text-white/60">
                  {formatDate(r.date)}
                </time>
              ) : null}
              <div className="text-xs tracking-wide text-white/50">
                {r.type === 'portfolio' ? 'PORTFOLIO' : 'POST'}
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                <Link
                  className="hover:text-cyan-100"
                  href={r.type === 'portfolio' ? `/portfolio/${r.slug}/` : `/posts/${r.slug}/`}
                >
                  <span
                    dangerouslySetInnerHTML={{
                      __html: highlightHtml(r.title, q),
                    }}
                  />
                </Link>
              </h2>

              {r.description ? (
                <p
                  className="mt-2 text-sm text-white/80"
                  dangerouslySetInnerHTML={{
                    __html: highlightHtml(r.description, q),
                  }}
                />
              ) : null}

              {(() => {
                const doc = docs.find((d) => d.slug === r.slug && d.type === r.type);
                const snippet = doc ? buildSnippet(doc.content, q) : '';
                return snippet ? (
                  <p
                    className="mt-3 text-sm text-white/60"
                    dangerouslySetInnerHTML={{
                      __html: highlightHtml(snippet, q),
                    }}
                  />
                ) : null;
              })()}
              {Array.isArray(r.tags) && r.tags.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
