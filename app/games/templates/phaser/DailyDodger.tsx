"use client";

import dynamic from "next/dynamic";

// Phaser needs the browser. We keep it in a client-only dynamic import.
const DailyDodgerImpl = dynamic(() => import("./DailyDodgerImpl"), { ssr: false });

export default function DailyDodger(props: {
  date: string;
  seed: number;
  stagePack: "classic" | "spiral" | "swarm" | "boss";
  difficulty: 1 | 2 | 3 | 4 | 5;
  theme: "neon" | "mono" | "sunset";
  onResult: (r: { cleared: boolean; score: number; timeMs: number }) => void;
  initialBest?: { bestScore: number; bestTimeMs?: number; cleared: boolean } | null;
}) {
  return <DailyDodgerImpl {...props} />;
}
