import { expect, it } from 'vitest';
import { parsePositions, updatePosition, removePosition } from './reading-position';
it('discards corrupt and invalid storage', () => {
  for (const raw of ['{', '{}', 'null', '[{"slug":"x","heading":1,"updatedAt":1}]']) expect(parsePositions(raw)).toEqual([]);
});
it('updates one slug without losing other articles and strips unrelated fields', () => {
  const a = { slug: 'a', heading: 'section-한글', updatedAt: 1 };
  const raw = updatePosition(JSON.stringify([{ ...a, extra: 'private' }]), { slug: 'b', heading: 'section-b', updatedAt: 2 });
  expect(parsePositions(raw)).toEqual([{ slug: 'b', heading: 'section-b', updatedAt: 2 }, a]);
  expect(parsePositions(updatePosition(raw, { ...a, heading: 'section-new', updatedAt: 3 }))[0].heading).toBe('section-new');
  expect(parsePositions(removePosition(raw, 'a')).map(p => p.slug)).toEqual(['b']);
});
it('keeps only the most recent 50 unique articles', () => {
  const records = Array.from({ length: 60 }, (_, i) => ({ slug: String(i), heading: 'section-a', updatedAt: i }));
  const result = parsePositions(JSON.stringify([...records, records[59]]));
  expect(result).toHaveLength(50); expect(result[0].slug).toBe('59'); expect(result[49].slug).toBe('10');
});
