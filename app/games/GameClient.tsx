"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DailyGame } from "../../src/lib/games";
import DailyDodger from "./templates/phaser/DailyDodger";

type GameRecord =
  | {
      type: "quiz";
      cleared: boolean;
      score: number; // 0 or 1
      pickedId: string;
      savedAt: number;
    }
  | {
      type: "memory";
      cleared: boolean;
      moves: number;
      timeMs: number;
      score: number;
      savedAt: number;
    }
  | {
      type: "phaser";
      cleared: boolean;
      bestScore: number;
      bestTimeMs?: number;
      savedAt: number;
    };

function storageKey(date: string) {
  return `dailyGame:${date}`;
}

function loadRecord(date: string): GameRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(date));
    if (!raw) return null;
    return JSON.parse(raw) as GameRecord;
  } catch {
    return null;
  }
}

function saveRecord(date: string, record: GameRecord) {
  try {
    localStorage.setItem(storageKey(date), JSON.stringify(record));
  } catch {
    // ignore
  }
}

function clearRecord(date: string) {
  try {
    localStorage.removeItem(storageKey(date));
  } catch {
    // ignore
  }
}

export default function GameClient({ game }: { game: DailyGame }) {
  const [record, setRecord] = useState<GameRecord | null>(null);

  useEffect(() => {
    setRecord(loadRecord(game.date));
  }, [game.date]);

  const handleClearQuiz = useCallback(
    (r: Extract<GameRecord, { type: "quiz" }>) => {
      saveRecord(game.date, r);
      setRecord(r);
    },
    [game.date]
  );

  const handleClearMemory = useCallback(
    (r: Extract<GameRecord, { type: "memory" }>) => {
      saveRecord(game.date, r);
      setRecord(r);
    },
    [game.date]
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
        <div className="text-sm text-white/70">
          {record?.cleared ? (
            record.type === "phaser" ? (
              <span>
                클리어 · 최고점 <span className="text-white">{record.bestScore}</span>
              </span>
            ) : (
              <span>
                클리어 · 점수 <span className="text-white">{record.score}</span>
              </span>
            )
          ) : (
            <span>아직 기록 없음</span>
          )}
        </div>

        <button
          type="button"
          className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70 hover:bg-black/40"
          onClick={() => {
            clearRecord(game.date);
            setRecord(null);
            // 게임별 내부 상태는 버튼 새로고침으로 리셋되게 처리(간단 버전)
            window.location.reload();
          }}
        >
          기록 초기화
        </button>
      </div>

      {game.type === "quiz" ? (
        <Quiz
          game={game}
          initial={record?.type === "quiz" ? record : null}
          onClear={handleClearQuiz}
        />
      ) : game.type === "memory" ? (
        <Memory
          game={game}
          initial={record?.type === "memory" ? record : null}
          onClear={handleClearMemory}
        />
      ) : (
        <PhaserWrapper
          game={game}
          record={record?.type === "phaser" ? record : null}
          onSave={(next) => {
            saveRecord(game.date, next);
            setRecord(next);
          }}
        />
      )}
    </div>
  );
}

function PhaserWrapper({
  game,
  record,
  onSave,
}: {
  game: Extract<DailyGame, { type: "phaser" }>;
  record: Extract<GameRecord, { type: "phaser" }> | null;
  onSave: (r: Extract<GameRecord, { type: "phaser" }>) => void;
}) {
  if (game.template === "dodger") {
    return (
      <DailyDodger
        date={game.date}
        seed={game.seed}
        stagePack={game.stagePack}
        difficulty={game.difficulty}
        theme={game.theme}
        initialBest={record ? { bestScore: record.bestScore, bestTimeMs: record.bestTimeMs, cleared: record.cleared } : null}
        onResult={({ cleared, score, timeMs }) => {
          const bestScore = Math.max(record?.bestScore ?? 0, score);
          const bestTimeMs = record?.bestTimeMs
            ? Math.min(record.bestTimeMs, timeMs)
            : timeMs;
          onSave({
            type: "phaser",
            cleared: record?.cleared ? true : cleared,
            bestScore,
            bestTimeMs,
            savedAt: Date.now(),
          });
        }}
      />
    );
  }

  return (
    <div className="text-white/80">
      아직 이 템플릿은 준비 중.
    </div>
  );
}

function Quiz({
  game,
  initial,
  onClear,
}: {
  game: Extract<DailyGame, { type: "quiz" }>;
  initial: Extract<GameRecord, { type: "quiz" }> | null;
  onClear: (r: Extract<GameRecord, { type: "quiz" }>) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial?.pickedId ?? null);
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
              onClick={() => {
                if (picked !== null) return;
                setPicked(c.id);

                const correct = Boolean(correctId) && c.id === correctId;
                onClear({
                  type: "quiz",
                  cleared: true,
                  score: correct ? 1 : 0,
                  pickedId: c.id,
                  savedAt: Date.now(),
                });
              }}
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
  initial,
  onClear,
}: {
  game: Extract<DailyGame, { type: "memory" }>;
  initial: Extract<GameRecord, { type: "memory" }> | null;
  onClear: (r: Extract<GameRecord, { type: "memory" }>) => void;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState<number>(initial?.moves ?? 0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

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

    if (startedAt === null) setStartedAt(Date.now());

    const next = [...open, id];
    setOpen(next);

    if (next.length === 2) {
      setMoves((m) => m + 1);

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

  useEffect(() => {
    if (!done) return;
    if (!startedAt) return;

    const timeMs = Math.max(0, Date.now() - startedAt);
    // 아주 단순한 점수: 빠를수록 +, 적은 이동수일수록 +
    const score = Math.max(0, Math.round(10000 / (1 + timeMs / 1000) + 5000 / (1 + moves)));

    onClear({
      type: "memory",
      cleared: true,
      moves,
      timeMs,
      score,
      savedAt: Date.now(),
    });
  }, [done, startedAt, moves, onClear]);

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
