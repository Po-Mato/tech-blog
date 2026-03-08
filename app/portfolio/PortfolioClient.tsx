"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PortfolioMeta } from "../../src/lib/portfolio";

type SortMode = "featured" | "new" | "title";

export default function PortfolioClient({ items }: { items: PortfolioMeta[] }) {
  const [stackFilter, setStackFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("featured");

  const allStacks = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const s of it.stack ?? []) set.add(s);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    let rows = items;

    if (stackFilter !== "all") {
      rows = rows.filter((p) => (p.stack ?? []).includes(stackFilter));
    }

    if (sortMode === "title") {
      rows = [...rows].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "new") {
      rows = [...rows].sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : -1));
    } else {
      rows = [...rows].sort((a, b) => {
        const af = a.featured ? 1 : 0;
        const bf = b.featured ? 1 : 0;
        if (af !== bf) return bf - af;
        return (a.date ?? "") < (b.date ?? "") ? 1 : -1;
      });
    }

    return rows;
  }, [items, sortMode, stackFilter]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-white/70">
          Stack
          <select
            value={stackFilter}
            onChange={(e) => setStackFilter(e.target.value)}
            className="ml-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-white"
          >
            <option value="all">전체</option>
            {allStacks.map((s) => (
              <option key={s} value={s}>
                {s}
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
            <option value="featured">추천</option>
            <option value="new">최신</option>
            <option value="title">이름</option>
          </select>
        </label>

        <span className="text-sm text-white/60">{filtered.length}개</span>
      </div>

      <ul className="grid gap-4 md:grid-cols-2">
        {filtered.map((p) => (
          <li
            key={p.slug}
            className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur transition hover:border-cyan-300/30 hover:bg-black/35"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {p.featured ? (
                <span className="rounded-full border border-cyan-300/35 bg-cyan-300/12 px-2 py-0.5 text-xs text-cyan-100">
                  Featured
                </span>
              ) : null}
              {p.date ? <div className="text-sm text-white/60">{p.date}</div> : null}
              {p.role ? <div className="text-sm text-white/60">Role: {p.role}</div> : null}
            </div>

            <h2 className="mt-2 text-xl font-semibold">
              <Link className="transition hover:text-cyan-100" href={`/portfolio/${p.slug}/`}>
                {p.title}
              </Link>
            </h2>

            {p.description ? <p className="mt-2 text-sm text-white/80">{p.description}</p> : null}

            {p.stack?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {p.stack.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStackFilter(s)}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 transition hover:border-cyan-300/35 hover:text-cyan-100"
                    title="이 스택으로 필터"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            {p.links && (p.links.github || p.links.demo || p.links.doc) ? (
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                {p.links.github ? (
                  <a
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 transition hover:border-cyan-300/35 hover:text-cyan-100"
                    href={p.links.github}
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub
                  </a>
                ) : null}
                {p.links.demo ? (
                  <a
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 transition hover:border-cyan-300/35 hover:text-cyan-100"
                    href={p.links.demo}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Demo
                  </a>
                ) : null}
                {p.links.doc ? (
                  <a
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 transition hover:border-cyan-300/35 hover:text-cyan-100"
                    href={p.links.doc}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Doc
                  </a>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
