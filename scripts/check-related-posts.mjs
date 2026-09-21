import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8799';
const session = `related-${process.pid}`;
function browser(...args) {
  const r = JSON.parse(execFileSync('agent-browser', ['--session', session, '--json', ...args], {encoding:'utf8',timeout:45000}));
  assert(r.success, r.error); return r.data;
}
const section = '[aria-labelledby="related-posts-heading"]';
const path = '/posts/2026-08-29-proactive-update/';
const expected = ['2026-09-02-proactive-update', '2026-08-26-proactive-update', '2026-08-09-proactive-update'];
try {
  const html = await (await fetch(new URL(path, base))).text();
  assert(html.includes('id="related-posts-heading"'), 'Related links must exist without JavaScript');
  for (const width of [390,1280]) {
    browser('set','viewport',String(width),'844');
    browser('open',new URL(path,base).href);
    browser('wait',section);
    const {result} = browser('eval',`(() => {
      const s=document.querySelector('${section}');s.scrollIntoView();
      return {links:[...s.querySelectorAll('a')].map(a=>a.getAttribute('href')), reasons:s.innerText,
        overflow:[...s.querySelectorAll('li')].some(e=>e.scrollWidth>e.clientWidth+1 || e.getBoundingClientRect().right>innerWidth),
        columns:getComputedStyle(s.querySelector('ul')).gridTemplateColumns.split(' ').length};
    })()`);
    assert.deepEqual(result.links,expected.map(slug=>'/posts/'+slug+'/'));
    assert(result.reasons.includes('Cloud Native')); assert(!result.overflow);
    assert.equal(result.columns,width===390?1:3);
    browser('screenshot',`/tmp/blog-related-${width}.png`);
    browser('click',section+' li:first-child a');
    browser('wait','--url','**/posts/2026-09-02-proactive-update/');
    const {result: overlaps} = browser('eval',`(() => {
      const existing=new Set([...document.querySelectorAll('nav[aria-label$="읽기 순서"] a')].map(a=>a.pathname));
      return [...document.querySelectorAll('${section} a')].some(a=>existing.has(a.pathname));
    })()`);
    assert(!overlaps,'Series duplicates');
    console.log(`${width}px related links, reasons, click-through and series exclusion passed`);
  }
} finally {browser('close');}
