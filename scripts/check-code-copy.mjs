// Requires agent-browser. Clipboard writes are captured in this isolated test
// session to exercise success, rejection and unsupported browser paths reliably.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] || 'http://localhost:8799';
const session = `code-copy-${process.pid}`;
function browser(...args) {
  const response = JSON.parse(execFileSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8', timeout: 45000,
  }));
  assert(response.success, response.error || 'Browser command failed');
  return response.data;
}
const evaluate = (js) => browser('eval', js).result;
const button = '.code-copy-toolbar button';
const status = '.code-copy-toolbar [role="status"]';
function open(slug) {
  browser('open', new URL(`/posts/${slug}/`, base).href);
  browser('wait', button);
}
function clipboard(mode) {
  evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: ${
    mode === 'missing' ? 'undefined' : `{writeText: async text => {
      ${mode === 'reject' ? "throw new DOMException('Denied', 'NotAllowedError');" : 'window.__copied = text; window.__copyCount = (window.__copyCount || 0) + 1;'}
    }}`
  } })`);
}
function matches(index) {
  assert(evaluate(`window.__copied === document.querySelectorAll('pre > code')[${index}].textContent`), 'Copied text must exactly match its own block');
}

try {
  const raw = await (await fetch(new URL('/posts/2026-09-02-proactive-update/', base))).text();
  const markup = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  assert(markup.includes('<pre><code'), 'Code must be present in server HTML without JavaScript');
  assert(!markup.includes('class="code-copy-toolbar"'), 'No inert copy buttons before hydration');
  open('2026-03-18-proactive-update');
  const count = evaluate(`document.querySelectorAll('${button}').length`);
  assert(count >= 2, 'Multi-block fixture must contain multiple code blocks');
  assert.equal(count, evaluate("document.querySelectorAll('pre > code').length"));
  clipboard('success');
  for (let index = 0; index < count; index++) {
    browser('click', `button[aria-label="${index + 1}번째 코드 블록 복사"]`);
    matches(index);
  }
  // Include literal entities, Korean text, tabs and final newlines.
  evaluate(`document.querySelector('pre > code').textContent = ${JSON.stringify('  <tag> &amp; "한글"\n\tvalue\n')}`);
  evaluate(`document.querySelector('${button}').focus()`);
  browser('press', 'Enter');
  matches(0);
  browser('press', 'Space');
  matches(0);
  assert.equal(evaluate('window.__copyCount'), count + 2, 'Both keyboard activations must copy');
  assert(evaluate(`document.querySelector('${status}').textContent.includes('복사했습니다')`));
  browser('wait', '--fn', `document.querySelector('${status}').textContent === ''`);

  clipboard('reject');
  browser('click', 'button[aria-label="1번째 코드 블록 복사"]');
  assert(evaluate(`document.querySelector('${status}').textContent.includes('직접 선택')`));
  clipboard('missing');
  browser('click', 'button[aria-label="1번째 코드 블록 복사"]');
  assert(evaluate(`document.querySelector('${status}').textContent.includes('직접 선택')`));
  assert.notEqual(evaluate(`document.querySelector('${button}').getAttribute('aria-disabled')`), 'true');

  for (const width of [390, 1280]) {
    browser('set', 'viewport', String(width), '844');
    open('2026-09-02-proactive-update');
    clipboard('success');
    browser('click', button);
    matches(0);
    assert(evaluate(`document.querySelector('${button}').getBoundingClientRect().height >= 44`));
    assert(evaluate('document.body.scrollWidth <= innerWidth'));
    browser('click', '.post-toc li:last-child a');
    assert.equal(evaluate('decodeURIComponent(location.hash)'), '#section-요약');
  }

  evaluate(`window.__oldStatus = document.querySelector('${status}');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => new Promise(resolve => { window.__resolveCopy = resolve; })
    } });`);
  browser('click', button);
  assert.equal(evaluate(`document.querySelector('${button}').getAttribute('aria-busy')`), 'true');
  browser('click', 'article > a[href="/"]');
  browser('wait', '--url', new URL('/', base).href);
  assert(evaluate(`(async () => {
    window.__resolveCopy(); await new Promise(resolve => setTimeout(resolve, 0));
    return !window.__oldStatus.isConnected && window.__oldStatus.textContent === '';
  })()`), 'Pending clipboard work must not update a disposed article');

  browser('open', new URL('/posts/2026-02-01-frontend-trends/', base).href);
  browser('wait', '.prose');
  assert.equal(evaluate("document.querySelectorAll('pre > code').length"), 0);
  assert.equal(evaluate(`document.querySelectorAll('${button}').length`), 0);
  open('2026-09-02-proactive-update');
  assert.equal(evaluate(`document.querySelectorAll('${button}').length`), 1, 'Revisiting must not duplicate controls');
  console.log(`Code copy passed: ${count} independent blocks, exact text, Enter/Space, repeated copy, feedback reset, denied/missing API, mobile/desktop, TOC, no-JS HTML, pending cleanup, no-code post, revisit.`);
} finally {
  browser('close');
}
