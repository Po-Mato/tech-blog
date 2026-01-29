import Link from "next/link";

import { getGameDates } from "../../src/lib/games";

export const dynamic = "force-static";

export default async function GamesPage() {
  const dates = await getGameDates();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-10">
        <h1 className="text-4xl font-bold">데일리 미니게임</h1>
        <p className="mt-3 text-lg text-white/80">
          매일 트렌드 기반으로 가볍게 즐기는 작은 게임.
        </p>
      </header>

      {dates.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">아직 게임이 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {dates.map((d) => (
            <li
              key={d}
              className="rounded-xl border border-white/10 bg-black/30 p-6 backdrop-blur"
            >
              <div className="text-sm text-white/60">{d}</div>
              <Link className="mt-1 inline-block text-xl font-semibold hover:underline" href={`/games/${d}/`}>
                오늘의 게임
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
