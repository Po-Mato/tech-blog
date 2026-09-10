// Requires agent-browser on PATH and a running static preview (or public URL).
// pnpm test:search-layout http://127.0.0.1:8799
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] || 'http://127.0.0.1:8799';
const session = `search-layout-${process.pid}`;
function browser(...args) {
  const response = JSON.parse(execFileSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8', timeout: 45000,
  }));
  assert(response.success, response.error || 'Browser command failed');
  return response.data;
}

function verify(width, scenario) {
  const { result } = browser('eval', `(() => {
    const list = document.querySelector('main ul');
    const bounds = list.getBoundingClientRect();
    const cards = [...list.children];
    return {
      count: cards.length,
      outside: cards.filter(card => {
        const rect = card.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
          || card.scrollWidth > card.clientWidth + 1;
      }).length,
      columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
      brokenHighlight: list.innerText.includes('ark class='),
      listInside: bounds.left >= 0 && bounds.right <= innerWidth,
    };
  })()`);
  assert(result.count > 0, 'Search results must load before checking layout');
  assert.equal(result.outside, 0, `${width}px ${scenario}: cards overflow their grid or clip text`);
  assert.equal(result.columns, width >= 768 ? 2 : 1, `${width}px: unexpected column count`);
  assert(result.listInside, `${width}px: list exceeds the viewport`);
  assert(!result.brokenHighlight, 'Search highlight markup leaked into text');
  console.log(`${width}px ${scenario}: ${result.count} cards fit; ${result.columns} column(s)`);
}

try {
  for (const width of [320, 390, 768, 1280]) {
    browser('set', 'viewport', String(width), '844');
    browser('open', new URL('/search/?q=AI%20a', base).href);
    browser('wait', '--fn', 'document.querySelectorAll("main li").length > 0');
    browser('eval', 'document.fonts.ready.then(() => true)');
    verify(width, 'actual content');
    // Stress unbroken titles, snippets and tags in the browser only; no source data changes.
    browser('eval', `(() => {
      const card = document.querySelector('main li');
      card.querySelector('h2 a').textContent = 'LongUnbrokenTitle'.repeat(30);
      card.querySelectorAll('p').forEach(p => p.textContent = 'UnbrokenSnippet'.repeat(30));
      card.querySelectorAll('div span').forEach(tag => tag.textContent = 'LongTag'.repeat(30));
    })()`);
    verify(width, 'long content');
  }
} finally {
  browser('close');
}
