'use client';

import { useEffect, useRef } from 'react';

export default function PostContent({ contentHtml }: { contentHtml: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    root.current?.querySelectorAll<HTMLElement>('pre > code').forEach((code, index) => {
      const pre = code.parentElement!;
      const toolbar = document.createElement('div');
      toolbar.className = 'code-copy-toolbar';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '코드 복사';
      button.setAttribute('aria-label', `${index + 1}번째 코드 블록 복사`);
      const status = document.createElement('span');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      toolbar.append(button, status);
      pre.before(toolbar);
      pre.classList.add('copy-enabled');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let copying = false;

      async function copy() {
        if (copying) return;
        clearTimeout(timer);
        status.textContent = '';
        copying = true;
        // Keep keyboard focus while blocking duplicate requests.
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('aria-busy', 'true');
        button.textContent = '복사 중…';
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          // textContent preserves indentation, entities and the final newline.
          // The toolbar lives outside pre/code so its label is never copied.
          await navigator.clipboard.writeText(code.textContent ?? '');
          if (disposed) return;
          status.textContent = '복사했습니다.';
          timer = setTimeout(() => { status.textContent = ''; }, 2500);
        } catch {
          if (disposed) return;
          status.textContent = '복사할 수 없습니다. 코드를 직접 선택해 복사해 주세요.';
        } finally {
          if (!disposed) {
            copying = false;
            button.removeAttribute('aria-disabled');
            button.removeAttribute('aria-busy');
            button.textContent = '코드 복사';
          }
        }
      }

      button.addEventListener('click', copy);
      cleanups.push(() => {
        clearTimeout(timer);
        button.removeEventListener('click', copy);
        toolbar.remove();
        pre.classList.remove('copy-enabled');
      });
    });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [contentHtml]);

  return (
    <div
      ref={root}
      className="prose prose-invert mt-10 max-w-none prose-headings:tracking-tight prose-p:text-white/80 prose-a:text-cyan-300 prose-a:transition prose-a:hover:text-cyan-100 prose-li:marker:text-cyan-300"
      // Only server-rendered markdown already processed by rehype-sanitize.
      dangerouslySetInnerHTML={{ __html: contentHtml }}
    />
  );
}
