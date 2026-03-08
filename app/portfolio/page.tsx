import { getAllPortfolio } from "../../src/lib/portfolio";
import PortfolioClient from "./PortfolioClient";

export const dynamic = "force-static";

export default async function PortfolioPage() {
  const items = await getAllPortfolio();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-12 text-white md:px-8">
      <header className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur">
        <p className="text-xs font-medium tracking-[0.22em] text-cyan-200/80">PORTFOLIO</p>
        <h1 className="mt-2 text-4xl font-semibold">프로젝트 포트폴리오</h1>
        <p className="mt-3 text-white/75">아키텍처, 구현, 운영까지 담은 실전 프로젝트 기록입니다.</p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">아직 포트폴리오가 없습니다.</p>
        </div>
      ) : (
        <PortfolioClient items={items} />
      )}
    </main>
  );
}
