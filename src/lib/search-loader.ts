export type SearchDoc = {
  id: string; type: 'post' | 'portfolio'; slug: string; title: string;
  description?: string; date?: string; tags?: string[]; content: string;
};
export type SearchLoadState =
  | { status: 'loading'; canRetry: boolean }
  | { status: 'error'; canRetry: true }
  | { status: 'ready'; docs: SearchDoc[] };

export function parseSearchIndex(value: unknown): SearchDoc[] {
  if (!value || typeof value !== 'object' || !('docs' in value) || !Array.isArray(value.docs)) {
    throw new Error('Invalid search index');
  }
  const ids = new Set<string>();
  for (const doc of value.docs) {
    if (!doc || typeof doc !== 'object' ||
        !['id', 'slug', 'title', 'content'].every(key => typeof doc[key] === 'string') ||
        !doc.id || !doc.slug || !['post', 'portfolio'].includes(doc.type) || ids.has(doc.id) ||
        (doc.description !== undefined && typeof doc.description !== 'string') ||
        (doc.date !== undefined && (typeof doc.date !== 'string' || !Number.isFinite(Date.parse(doc.date)))) ||
        (doc.tags !== undefined && (!Array.isArray(doc.tags) || !doc.tags.every((tag: unknown) => typeof tag === 'string')))) {
      throw new Error('Invalid search document');
    }
    ids.add(doc.id);
  }
  return value.docs;
}

// One active attempt; timeout covers both response headers and body parsing.
export function createSearchLoader(
  publish: (state: SearchLoadState) => void,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
) {
  let active: AbortController | undefined;
  let disposed = false;
  let canRetry = false;
  return {
    async start() {
      if (disposed || active) return;
      const controller = new AbortController();
      active = controller;
      publish({ status: 'loading', canRetry });
      let rejectAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new Error('Search request cancelled or timed out'));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const request = (async () => {
          const response = await fetcher('/search-index.json', { cache: 'no-cache', signal: controller.signal });
          if (!response.ok) throw new Error('Search index unavailable');
          return parseSearchIndex(await response.json());
        })();
        const docs = await Promise.race([request, aborted]);
        if (!disposed && active === controller) publish({ status: 'ready', docs });
      } catch {
        if (!disposed && active === controller) {
          canRetry = true;
          publish({ status: 'error', canRetry: true });
        }
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', rejectAbort);
        if (active === controller) active = undefined;
      }
    },
    dispose() {
      disposed = true;
      active?.abort();
      active = undefined;
    },
  };
}
