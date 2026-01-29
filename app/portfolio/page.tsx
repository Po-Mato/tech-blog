import Link from "next/link";

import { getAllPortfolio } from "../../src/lib/portfolio";

export const dynamic = "force-static";

export default async function PortfolioPage() {
  const items = await getAllPortfolio();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-10">
        <h1 className="text-4xl font-bold">포트폴리오</h1>
        <p className="mt-3 text-lg text-white/80">프로젝트 기록을 모아둡니다.</p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">아직 포트폴리오가 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((p) => (
            <li
              key={p.slug}
              className="rounded-xl border border-white/10 bg-black/30 p-6 backdrop-blur"
            >
              {p.date ? <div className="text-sm text-white/60">{p.date}</div> : null}
              <h2 className="mt-1 text-2xl font-semibold">
                <Link className="hover:underline" href={`/portfolio/${p.slug}/`}>
                  {p.title}
                </Link>
              </h2>
              {p.role ? <div className="mt-2 text-sm text-white/70">Role: {p.role}</div> : null}
              {p.description ? <p className="mt-2 text-white/80">{p.description}</p> : null}

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
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
                      href={p.links.github}
                      target="_blank"
                      rel="noreferrer"
                    >
                      GitHub
                    </a>
                  ) : null}
                  {p.links.demo ? (
                    <a
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
                      href={p.links.demo}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Demo
                    </a>
                  ) : null}
                  {p.links.doc ? (
                    <a
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
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
