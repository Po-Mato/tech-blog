import { describe, expect, it } from 'vitest';
import { formatDate, normalizeDate, normalizeTags } from './metadata.mjs';

describe('publication metadata', () => {
  it('normalizes quoted and YAML dates identically, with a stable display', () => {
    expect(normalizeDate('2026-09-02')).toBe(normalizeDate(new Date('2026-09-02')));
    expect(formatDate('2026-09-02T00:00:00.000Z')).toBe('2026.09.02');
  });
  it.each(['', undefined, 'invalid', '2026-02-30', '2026-13-01'])(
    'rejects an invalid date (%s) before it can corrupt sorting',
    (value) => {
      expect(() => normalizeDate(value)).toThrow();
    },
  );
  it('merges only known aliases, deduplicates, and preserves distinct topics', () => {
    expect(
      normalizeTags([
        'AI',
        ' AI Agent ',
        'AI Agents',
        'ai agents',
        'Agentic-AI',
        'AgenticAI',
        'RAG',
      ]),
    ).toEqual(['AI', 'AI Agents', 'Agentic AI', 'RAG']);
  });
});
