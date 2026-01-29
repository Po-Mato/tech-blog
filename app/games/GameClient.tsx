"use client";

import { useMemo, useState } from "react";

import type { DailyGame } from "../../src/lib/games";

export default function GameClient({ game }: { game: DailyGame }) {
  if (game.type === "quiz") return <Quiz game={game} />;
  return <Memory game={game} />;
}

function Quiz({
  game,
}: {
  game: Extract<DailyGame, { type: "quiz" }>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const correctId = useMemo(
    () => game.choices.find((c) => c.correct)?.id ?? null,
    [game.choices]
  );
  const isCorrect = picked && correctId ? picked === correctId : false;

  return (
    <div>
      <div className="text-sm text-white/60">퀴즈</div>
      <h2 className="mt-2 text-2xl font-semibold">{game.question}</h2>

      <div className="mt-5 grid gap-3">
        {game.choices.map((c) => {
          const selected = picked === c.id;
          const show = picked !== null;
          const border = show
            ? c.correct
              ? "border-emerald-300/50"
              : selected
                ? "border-rose-300/50"
                : "border-white/10"
            : "border-white/10";

          return (
            <button
              key={c.id}
              type="button"
              className={`w-full rounded-xl border ${border} bg-white/5 px-4 py-3 text-left hover:bg-white/10`}
              onClick={() => setPicked(c.id)}
              disabled={picked !== null}
            >
              <div className="font-medium">{c.label}</div>
              {show && selected ? (
                <div className="mt-1 text-sm text-white/60">
                  {isCorrect ? "정답!" : "틀렸어요"}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      {picked ? (
        <div className="mt-5 text-sm text-white/70">
          {isCorrect ? "오늘도 트렌드 감 좋다." : "내일 다시 도전!"}
        </div>
      ) : (
        <div className="mt-5 text-sm text-white/60">하나를 골라봐.</div>
      )}
    </div>
  );
}

function Memory({
  game,
}: {
  game: Extract<DailyGame, { type: "memory" }>;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());

  const cards = useMemo(() => {
    // 같은 라벨 2장씩이라고 가정
    const byLabel = new Map<string, string[]>();
    for (const c of game.cards) {
      const arr = byLabel.get(c.label) ?? [];
      arr.push(c.id);
      byLabel.set(c.label, arr);
    }

    return game.cards.map((c) => ({
      ...c,
      group: byLabel.get(c.label)?.[0] ?? c.id,
    }));
  }, [game.cards]);

  function flip(id: string) {
    if (matched.has(id)) return;
    if (open.includes(id)) return;
    if (open.length >= 2) return;

    const next = [...open, id];
    setOpen(next);

    if (next.length === 2) {
      const [a, b] = next;
      const ca = cards.find((c) => c.id === a);
      const cb = cards.find((c) => c.id === b);
      const ok = ca && cb && ca.label === cb.label;

      window.setTimeout(() => {
        if (ok) {
          setMatched((m) => {
            const n = new Set(m);
            n.add(a);
            n.add(b);
            return n;
          });
        }
        setOpen([]);
      }, 550);
    }
  }

  const done = matched.size === game.cards.length;

  return (
    <div>
      <div className="text-sm text-white/60">카드 매칭</div>
      <h2 className="mt-2 text-2xl font-semibold">같은 키워드 2장 찾기</h2>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => {
          const isOpen = open.includes(c.id) || matched.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`aspect-[3/2] rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10`}
              onClick={() => flip(c.id)}
              disabled={matched.has(c.id)}
            >
              <div className="text-xs text-white/50">{isOpen ? "OPEN" : "HIDDEN"}</div>
              <div className="mt-2 font-medium">
                {isOpen ? c.label : "????"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 text-sm text-white/70">
        {done ? "클리어!" : "빠르게 맞춰봐."}
      </div>
    </div>
  );
}
