"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import MiniSearch from "minisearch";

type SearchDoc = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  date?: string;
  tags?: string[];
  content: string;
};

type SearchIndex = {
  version: number;
  docs: SearchDoc[];
};

function buildMiniSearch(docs: SearchDoc[]) {
  const miniSearch = new MiniSearch<SearchDoc>({
    fields: ["title", "description", "tags", "content"],
    storeFields: ["slug", "title", "description", "date", "tags"],
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

  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return [];
    return miniSearch.search(query, { combineWith: "AND" });
  }, [miniSearch, q]);

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-8">
        <h1 className="text-4xl font-bold">검색</h1>
        <p className="mt-3 text-lg text-white/80">
          제목/설명/태그/본문에서 검색합니다.
        </p>
      </header>

      <div className="mb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: nextjs, threejs, i18n ..."
          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/30"
        />
        <div className="mt-2 text-sm text-white/60">
          Tip: URL로도 검색 가능해요 → <code className="text-white/70">/search?q=nextjs</code>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">인덱스를 불러오는 중...</p>
        </div>
      ) : !q.trim() ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">검색어를 입력해줘.</p>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">검색 결과가 없어요.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {results.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-white/10 bg-black/30 p-6 backdrop-blur"
            >
              {r.date ? (
                <div className="text-sm text-white/60">{r.date}</div>
              ) : null}
              <h2 className="mt-1 text-2xl font-semibold">
                <Link className="hover:underline" href={`/posts/${r.slug}`}>
                  {r.title}
                </Link>
              </h2>
              {r.description ? (
                <p className="mt-2 text-white/80">{r.description}</p>
              ) : null}
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
          인덱스 문서는 <code className="text-white/60">/search-index.json</code>에서
          제공됩니다.
        </p>
      </footer>
    </main>
  );
}
