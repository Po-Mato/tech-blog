import fs from "node:fs/promises";
import path from "node:path";

export type GameType = "quiz" | "memory";

export type QuizChoice = {
  id: string;
  label: string;
  correct: boolean;
};

export type QuizGame = {
  type: "quiz";
  question: string;
  choices: QuizChoice[];
};

export type MemoryCard = {
  id: string;
  label: string;
};

export type MemoryGame = {
  type: "memory";
  cards: MemoryCard[];
};

export type DailyGame = {
  date: string; // YYYY-MM-DD (KST)
  title: string;
  description?: string;
} & (QuizGame | MemoryGame);

const gamesDirectory = path.join(process.cwd(), "content", "games");

export async function getGameDates(): Promise<string[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(gamesDirectory);
  } catch {
    return [];
  }

  return files
    .filter((f) => f.endsWith(".json") && /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/i, ""))
    .sort((a, b) => (a < b ? 1 : -1));
}

export async function getGameByDate(date: string): Promise<DailyGame | null> {
  const filePath = path.join(gamesDirectory, `${date}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as DailyGame;
  } catch {
    return null;
  }
}
