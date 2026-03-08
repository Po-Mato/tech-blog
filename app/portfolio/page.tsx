import Link from "next/link";

import { getAllPortfolio } from "../../src/lib/portfolio";

export const dynamic = "force-static";

export default async function PortfolioPage() {
  const items = await getAllPortfolio();

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-white md:px-8">
      <header className="mb-10 rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur-xl md:p-10 transition duration-500 hover:border-cyan-300/30 hover:shadow-cyan-900/30">
        <p className="text-xs font-medium tracking-[0.25em] text-cyan-200/80">
          PROJECTS
        </p>
        <h1 className="mt-2 text-4xl font-bold leading-tight md:text-6xl">
          구현된 기술들의
          <br />
          실증 기록
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/75 md:text-lg">
          복잡한 기술 스택을 깊이 파고든 과정, 아키텍처 의사결정 및 시행착오를
          투명하게 공유합니다.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {items.length ? (
            <Link
              href={`/portfolio/${items[0].slug}/`}
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm text-white/85 transition duration-300 hover:border-white/20 hover:bg-white/15"
            >
              최신 프로젝트 보기
            </Link>
          ) : null}
          <Link
            href="/search/?q=portfolio"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/70 transition duration-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            전체 검색
          </Link>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">아직 포트폴리오가 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((p) => (
            <li
              key={p.slug}
              className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur transition duration-200 hover:border-cyan-300/35 hover:bg-black/40"
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

              <h2 className="mt-2 text-xl font-semibold leading-snug">
                <Link className="transition hover:text-cyan-100" href={`/portfolio/${p.slug}/`}>
                  {p.title}
                </Link>
              </h2>

              {p.description ? <p className="mt-2 text-sm text-white/80">{p.description}</p> : null}

              {p.stack?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.stack.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
                    >
                      {s}
                    </span>
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
      )}
    </main>
  );
}
