// Shared by Next.js pages and the Node build scripts.
export const TAG_ALIASES = {
  frontend: 'Frontend',
  typescript: 'TypeScript',
  architecture: 'Architecture',
  ai: 'AI',
  'Local-first': 'Local-First',
  react: 'React',
  'AI Agent': 'AI Agents',
  'AI-Agent': 'AI Agents',
  'AI-Agents': 'AI Agents',
  AgenticAI: 'Agentic AI',
  'Agentic-AI': 'Agentic AI',
  SoftwareEngineering: 'Software Engineering',
  'Software-Engineering': 'Software Engineering',
  'Software-Architecture': 'Software Architecture',
  'Cloud-Native': 'Cloud Native',
  'Platform-Engineering': 'Platform Engineering',
  'System-Design': 'System Design',
  '2026-Trends': '2026 Trends',
};

/** @param {string} tag */
export function normalizeTag(tag) {
  const trimmed = tag.trim();
  const alias = Object.keys(TAG_ALIASES).find((key) => key.toLowerCase() === trimmed.toLowerCase());
  const canonical = Object.values(TAG_ALIASES).find(
    (value) => value.toLowerCase() === trimmed.toLowerCase(),
  );
  return alias ? TAG_ALIASES[alias] : canonical || trimmed;
}

/** @param {unknown} tags */
export function normalizeTags(tags) {
  return Array.isArray(tags)
    ? [...new Set(tags.map((tag) => normalizeTag(String(tag))).filter(Boolean))]
    : [];
}

/** @param {unknown} value */
export function normalizeDate(value) {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw))
    throw new Error(`Invalid publication date: ${raw || '(missing)'}`);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw.slice(0, 10)) {
    throw new Error(`Invalid publication date: ${raw}`);
  }
  return date.toISOString();
}

/** @param {string} value */
export function formatDate(value) {
  return normalizeDate(value).slice(0, 10).replaceAll('-', '.');
}
