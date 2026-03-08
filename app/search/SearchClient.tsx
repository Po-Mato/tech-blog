"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import MiniSearch from "minisearch";

function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getQueryTerms(q: string): string[] {
  return q
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function highlightHtml(text: string, q: string): string {
  const escaped = escapeHtml(text);
  const terms = getQueryTerms(q);
  if (!terms.length) return escaped;

  const sorted = [...terms].sort((a, b) => b.length - a.length);
  let out = escaped;

  for (const term of sorted) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    out = out.replace(
      re,
      '<mark class="rounded bg-cyan-300/20 px-1 text-cyan-50">$1</mark>',
    );
  }

  return out;
}

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
  return (start > 0 ? "…" : "") + snippet + (start + maxLen < content.length ? "…" : "");
}

type SearchDoc = {
  id: string;
  type: "post" | "portfolio";
  slug: string;
  title: string;
  description?: string;
  date?: string;
  tags?: string[];
  content: string;
};

type SortMode = "relevance" | "new";

type SearchIndex = {
  version: number;
  docs: SearchDoc[];
};

function buildMiniSearch(docs: SearchDoc[]) {
  const miniSearch = new MiniSearch<SearchDoc>({
    fields: ["title", "description", "tags", "content"],
    storeFields: ["type", "slug", "title", "description", "date", "tags"],
    searchOptions: {
      boost: { title: 5, tags: 3, description: 2, content: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  miniSearch.addAll(docs);
  return miniSearch;
}

export default function SearchClient() {
  const searchParams = useSearchParams();
  const initialQ = (searchParams.get("q") ?? "").trim();

  const [q, setQ] = useState(initialQ);
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("relevance");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/search-index.json", { cache: "force-cache" });
        const json = (await res.json()) as SearchIndex;
        if (!cancelled) setDocs(json.docs ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const miniSearch = useMemo(() => buildMiniSearch(docs), [docs]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) for (const t of d.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [docs]);

  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return [];

    let rows = miniSearch.search(query, { combineWith: "AND" });

    if (tagFilter !== "all") {
      rows = rows.filter((r) => (r.tags ?? []).includes(tagFilter));
    }

    if (sortMode === "new") {
      rows = [...rows].sort((a, b) => {
        const ad = a.date ? Date.parse(a.date) : 0;
        const bd = b.date ? Date.parse(b.date) : 0;
        return bd - ad;
      });
    }

    return rows;
  }, [miniSearch, q, sortMode, tagFilter]);

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-12 text-white md:px-8">
      <header className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur">
        <p className="text-xs font-medium tracking-[0.22em] text-cyan-200/80">SEARCH</p>
        <h1 className="mt-2 text-4xl font-semibold">통합 검색</h1>
        <p className="mt-3 text-white/75">제목/설명/태그/본문 전체에서 검색합니다.</p>
      </header>

      <div className="mb-6 space-y-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: nextjs, threejs, i18n ..."
          className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-white/40 outline-none transition focus:border-cyan-300/40"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-white/70">
            태그
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="ml-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-white"
            >
              <option value="all">전체</option>
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
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="ml-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-white"
            >
              <option value="relevance">관련도</option>
              <option value="new">최신순</option>
            </select>
          </label>

          <span className="text-sm text-white/55">
            Tip: <code className="text-white/70">/search?q=nextjs</code>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">인덱스를 불러오는 중...</p>
        </div>
      ) : !q.trim() ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">검색어를 입력해줘.</p>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">검색 결과가 없어요.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {results.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur transition hover:border-cyan-300/30 hover:bg-black/35"
            >
              {r.date ? <div className="text-sm text-white/60">{r.date}</div> : null}
              <div className="text-xs tracking-wide text-white/50">
                {r.type === "portfolio" ? "PORTFOLIO" : "POST"}
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                <Link
                  className="transition hover:text-cyan-100"
                  href={r.type === "portfolio" ? `/portfolio/${r.slug}/` : `/posts/${r.slug}/`}
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
                const snippet = doc ? buildSnippet(doc.content, q) : "";
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

      <footer className="mt-10 text-sm text-white/50">
        <p>
          인덱스 문서: <code className="text-white/60">/search-index.json</code>
        </p>
      </footer>
    </main>
  );
}
