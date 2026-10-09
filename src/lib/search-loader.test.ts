import { afterEach, expect, it, vi } from 'vitest';
import { createSearchLoader, parseSearchIndex, type SearchLoadState } from './search-loader';
const doc = { id: 'post:a', type: 'post', slug: 'a', title: '글', content: '본문', tags: ['한글'] };
const response = () => new Response(JSON.stringify({ version: 1, docs: [doc] }));
afterEach(() => vi.useRealTimers());
it('validates documents before they reach the search engine', () => {
  expect(parseSearchIndex({ docs: [] })).toEqual([]);
  expect(parseSearchIndex({ docs: [doc] })).toEqual([doc]);
  for (const value of [{}, { docs: null }, { docs: [doc, doc] }, { docs: [{ ...doc, tags: [4] }] }, { docs: [{ ...doc, content: null }] }, { docs: [{ ...doc, date: 'invalid' }] }]) {
    expect(() => parseSearchIndex(value)).toThrow();
  }
});
it('recovers after HTTP, JSON and shape failures without automatic retries', async () => {
  const states: SearchLoadState[] = [];
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('{')).mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(response());
  const loader = createSearchLoader(s => states.push(s), fetcher);
  for (let i = 0; i < 3; i++) { await loader.start(); expect(states.at(-1)?.status).toBe('error'); expect(fetcher).toHaveBeenCalledTimes(i + 1); }
  await loader.start(); expect(states.at(-1)).toEqual({ status: 'ready', docs: [doc] });
});
it('blocks duplicate starts and cancels on disposal without publishing late results', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(r => { resolve = r; }));
  const states: SearchLoadState[] = [];
  const loader = createSearchLoader(s => states.push(s), fetcher);
  const pending = loader.start(); void loader.start(); expect(fetcher).toHaveBeenCalledTimes(1);
  loader.dispose(); await pending; resolve(response()); await Promise.resolve();
  expect(states.map(s => s.status)).toEqual(['loading']);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await loader.start(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('times out a stuck response body and ignores its result after a successful retry', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce({ ok: true, json: () => new Promise(r => { finish = r; }) } as Response).mockResolvedValueOnce(response());
  const states: SearchLoadState[] = [];
  const loader = createSearchLoader(s => states.push(s), fetcher, 50);
  const first = loader.start(); await vi.advanceTimersByTimeAsync(50); await first;
  expect(states.at(-1)?.status).toBe('error');
  await loader.start(); const count = states.length;
  finish({ docs: [] }); await Promise.resolve();
  expect(states).toHaveLength(count); expect(states.at(-1)).toEqual({ status: 'ready', docs: [doc] });
  expect(vi.getTimerCount()).toBe(0);
});
