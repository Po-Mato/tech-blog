'use client';

import { useEffect, useRef } from 'react';
import { READING_KEY, parsePositions, updatePosition, removePosition } from '../lib/reading-position';

export default function ReadingPosition({ slug }: { slug: string }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = root.current;
    const article = panel?.closest('article');
    if (!panel || !article) return;
    const headings = Array.from(article.querySelectorAll<HTMLElement>('.prose h2[id], .prose h3[id]'));
    if (headings.length < 2) return;
    const resume = panel.querySelector<HTMLButtonElement>('[data-resume]')!;
    const erase = panel.querySelector<HTMLButtonElement>('[data-erase]')!;
    const label = panel.querySelector<HTMLElement>('[data-heading]')!;
    const status = panel.querySelector<HTMLElement>('[role="status"]')!;
    let saved: HTMLElement | undefined;
    try {
      const record = parsePositions(localStorage.getItem(READING_KEY)).find(p => p.slug === slug);
      saved = headings.find(h => h.id === record?.heading);
    } catch { return; }
    if (saved && !location.hash) {
      label.textContent = saved.textContent?.replace(/\s*#\s*$/, '') ?? '';
      panel.hidden = false;
    }
    let armed = false;
    let lastHeading = saved?.id;
    let pending: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => headings.filter(h => h.getBoundingClientRect().top <= 112).at(-1)?.id;
    const flush = () => {
      if (!pending) return;
      try {
        localStorage.setItem(READING_KEY, updatePosition(localStorage.getItem(READING_KEY), {
          slug, heading: pending, updatedAt: Date.now(),
        }));
        lastHeading = pending;
      } catch { /* Storage is optional; reading remains available. */ }
      pending = undefined;
    };
    const scroll = () => {
      if (!armed) return;
      const heading = current();
      if (!heading || heading === lastHeading) {
        clearTimeout(timer); pending = undefined; return;
      }
      pending = heading;
      clearTimeout(timer);
      timer = setTimeout(flush, 200);
    };
    const arm = () => { armed = true; };
    const key = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) &&
          !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) arm();
    };
    let clickedHash: string | undefined;
    const anchor = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (link) { clickedHash = link.hash; arm(); }
    };
    const restore = () => {
      if (!saved?.isConnected) return;
      armed = false;
      clearTimeout(timer); pending = undefined;
      // User activation alone changes the URL and focus; initial render never scrolls.
      history.pushState(null, '', `#${encodeURIComponent(saved.id)}`);
      saved.scrollIntoView({ behavior: 'instant', block: 'start' });
      saved.setAttribute('tabindex', '-1');
      saved.focus({ preventScroll: true });
      const heading = saved;
      heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
    };
    const clear = () => {
      clearTimeout(timer); pending = undefined; armed = false;
      lastHeading = current();
      try {
        localStorage.setItem(READING_KEY, removePosition(localStorage.getItem(READING_KEY), slug));
        panel.hidden = true;
        const toc = article.querySelector<HTMLElement>('.post-toc summary');
        toc?.focus();
      } catch { status.textContent = '기록을 삭제하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.'; }
    };
    const freeze = () => {
      // Native fragment links also emit popstate. Keep a direct TOC click armed.
      const directLink = clickedHash === location.hash;
      clickedHash = undefined;
      if (directLink) return;
      armed = false; clearTimeout(timer); pending = undefined;
    };
    window.addEventListener('wheel', arm, { passive: true });
    window.addEventListener('touchmove', arm, { passive: true });
    window.addEventListener('pointerdown', arm, { passive: true });
    window.addEventListener('keydown', key);
    article.addEventListener('click', anchor);
    window.addEventListener('scroll', scroll, { passive: true, capture: true });
    window.addEventListener('popstate', freeze);
    window.addEventListener('pagehide', flush);
    resume.addEventListener('click', restore);
    erase.addEventListener('click', clear);
    return () => {
      clearTimeout(timer); flush();
      window.removeEventListener('wheel', arm);
      window.removeEventListener('touchmove', arm);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', key);
      article.removeEventListener('click', anchor);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('popstate', freeze);
      window.removeEventListener('pagehide', flush);
      resume.removeEventListener('click', restore);
      erase.removeEventListener('click', clear);
      panel.hidden = true;
    };
  }, [slug]);
  return <aside ref={root} hidden data-reading-position aria-label="읽던 문단 이어보기" className="mt-6 rounded-xl border border-cyan-200/20 bg-slate-950/60 p-5">
    <p className="text-sm text-white/70">이 브라우저에 저장된 읽기 위치</p>
    <p data-heading className="mt-2 break-words font-semibold text-cyan-100" />
    <div className="mt-3 flex flex-wrap gap-3">
      <button data-resume type="button" className="min-h-11 rounded-lg border border-cyan-200/40 px-4 text-cyan-100">이어 읽기</button>
      <button data-erase type="button" className="min-h-11 rounded-lg border border-white/20 px-4 text-white/80">이 글의 기록 삭제</button>
    </div>
    <p className="mt-3 text-xs text-white/60">이 기기에만 저장됩니다. 삭제 후 새로운 문단을 읽으면 다시 기록됩니다.</p>
    <p role="status" className="mt-2 text-sm text-white/80" />
  </aside>;
}
