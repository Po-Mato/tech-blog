import fs from "node:fs/promises";
import path from "node:path";

function kstDateString(now = new Date()) {
  // KST = UTC+9
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.toISOString().slice(0, 10);
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDate(dateStr) {
  // simple deterministic seed from YYYY-MM-DD
  let s = 0;
  for (let i = 0; i < dateStr.length; i++) s = (s * 31 + dateStr.charCodeAt(i)) >>> 0;
  return s;
}

function pick(rng, arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function uniq(arr) {
  return [...new Set(arr)];
}

async function readIfExists(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function extractGitHubReposFromMarkdown(md) {
  // Extract owner/repo from GitHub URLs
  const re = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(md))) {
    out.push(`${m[1]}/${m[2]}`);
  }
  return uniq(out);
}

async function main() {
  const date = kstDateString();
  const seed = seedFromDate(date);
  const rng = mulberry32(seed);

  const root = process.cwd();
  const postsDir = path.join(root, "content", "posts");
  const gamesDir = path.join(root, "content", "games");
  await fs.mkdir(gamesDir, { recursive: true });

  const gamePath = path.join(gamesDir, `${date}.json`);
  const existing = await readIfExists(gamePath);
  if (existing) {
    console.log(`[daily-game] ${date} already exists: ${gamePath}`);
    return;
  }

  const todayPostSlug = `frontend-trends-${date}`;
  const todayPostPath = path.join(postsDir, `${todayPostSlug}.md`);
  const postMd = (await readIfExists(todayPostPath)) ?? "";

  const repos = extractGitHubReposFromMarkdown(postMd);
  // fallback pool (still trend-ish)
  const fallback = [
    "facebook/react",
    "vercel/next.js",
    "tailwindlabs/tailwindcss",
    "microsoft/TypeScript",
    "yjs/yjs",
    "swagger-api/swagger-ui",
  ];

  const pool = uniq([...(repos.length ? repos : []), ...fallback]);

  // choose game type deterministically
  const types = ["quiz", "memory"]; // extend later
  const type = types[Math.floor(rng() * types.length)];

  let game;

  if (type === "quiz") {
    const correct = pick(rng, pool, 3)[0] ?? pool[0];
    const wrong = pick(rng, pool.filter((r) => r !== correct), 3);
    const choices = pick(rng, uniq([correct, ...wrong]), 4).map((label, i) => ({
      id: String(i + 1),
      label,
      correct: label === correct,
    }));

    game = {
      date,
      type: "quiz",
      title: "오늘의 트렌드 퀴즈",
      description: "아래 보기 중 ‘오늘 트렌드 글에 등장한’ 프로젝트를 맞춰봐.",
      question: "오늘 트렌드에 포함된 repo는?",
      choices,
    };
  } else {
    // memory match: 6 labels => 12 cards
    const labels = pick(rng, pool, 6);
    const cards = [];
    let id = 1;
    for (const label of labels) {
      cards.push({ id: String(id++), label });
      cards.push({ id: String(id++), label });
    }

    // shuffle
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    game = {
      date,
      type: "memory",
      title: "오늘의 키워드 카드 매칭",
      description: "오늘 트렌드 글에서 나온 키워드(Repo) 2장을 찾아서 맞춰봐.",
      cards,
    };
  }

  await fs.writeFile(gamePath, JSON.stringify(game, null, 2) + "\n", "utf8");
  console.log(`[daily-game] wrote ${gamePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
