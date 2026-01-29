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
  // deterministic seed from YYYY-MM-DD
  let s = 0;
  for (let i = 0; i < dateStr.length; i++) s = (s * 31 + dateStr.charCodeAt(i)) >>> 0;
  return s;
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
  return [...new Set(out)];
}

function toYYYYMMDDNumber(dateStr) {
  return Number(dateStr.replace(/-/g, ""));
}

function pickOne(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
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

  // Use today's trend post as entropy (optional) — for future expansion
  const todayPostSlug = `frontend-trends-${date}`;
  const todayPostPath = path.join(postsDir, `${todayPostSlug}.md`);
  const postMd = (await readIfExists(todayPostPath)) ?? "";
  const repos = extractGitHubReposFromMarkdown(postMd);

  // Phaser template (complex daily game)
  // Occasionally rotate stage packs to feel like "new stages".
  const dayNum = toYYYYMMDDNumber(date);
  const packs = /** @type {const} */ (["classic", "spiral", "swarm", "boss"]);

  // Most days follow a cycle; sometimes (when repos are rich) bias to boss.
  let stagePack = packs[dayNum % packs.length];
  if (repos.length >= 6 && rng() > 0.75) stagePack = "boss";

  const difficulty = /** @type {1|2|3|4|5} */ (Math.max(1, Math.min(5, 2 + (dayNum % 4))));
  const theme = /** @type {"neon"|"mono"|"sunset"} */ (pickOne(rng, ["neon", "mono", "sunset"]));

  const game = {
    date,
    type: "phaser",
    template: "dodger",
    title: `Daily Dodger — ${stagePack.toUpperCase()}`,
    description: "탄막을 피하고 오브를 먹어서 점수를 올려봐. 5 스테이지 생존하면 클리어! (매일 시드/스테이지 팩 변경)",
    seed: dayNum,
    stagePack,
    difficulty,
    theme,
  };

  await fs.writeFile(gamePath, JSON.stringify(game, null, 2) + "\n", "utf8");
  console.log(`[daily-game] wrote ${gamePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
