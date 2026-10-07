export const READING_KEY = 'blog-reading-position-v1';
export type ReadingRecord = { slug: string; heading: string; updatedAt: number };
export function parsePositions(raw: string | null): ReadingRecord[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((item): item is ReadingRecord => {
      if (!item || typeof item.slug !== 'string' || !item.slug || item.slug.length > 300 ||
          typeof item.heading !== 'string' || !item.heading.startsWith('section-') || item.heading.length > 1000 ||
          typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt) || item.updatedAt < 0) return false;
      return true;
    }).sort((a, b) => b.updatedAt - a.updatedAt).filter(item => {
      if (seen.has(item.slug)) return false;
      seen.add(item.slug); return true;
    }).slice(0, 50).map(({ slug, heading, updatedAt }) => ({ slug, heading, updatedAt }));
  } catch { return []; }
}
export function updatePosition(raw: string | null, record: ReadingRecord): string {
  return JSON.stringify(parsePositions(JSON.stringify([record, ...parsePositions(raw).filter(p => p.slug !== record.slug)])));
}
export function removePosition(raw: string | null, slug: string): string {
  return JSON.stringify(parsePositions(raw).filter(p => p.slug !== slug));
}
