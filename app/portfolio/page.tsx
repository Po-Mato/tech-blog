import { getAllPortfolio } from "../../src/lib/portfolio";
import PortfolioClient from "./PortfolioClient";

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
        <PortfolioClient items={items} />
      )}
    </main>
  );
}
