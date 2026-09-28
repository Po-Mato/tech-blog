import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8801';
const session = `tag-search-${process.pid}`;
function b(...args) {
  const r = JSON.parse(execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8', timeout: 45000 }));
  assert(r.success, r.error); return r.data;
}
const evaluate = js => b('eval', js).result;
const entries = () => evaluate(`Array.from(document.querySelectorAll('#tag-results a'),a=>({href:a.getAttribute('href'),text:a.textContent}))`);
const input = '#tag-name-query';
function ready() { b('wait', '--fn', `document.querySelector('${input}') && !document.querySelector('${input}').closest('[hidden]')`); }
function count(n) { b('wait', '--fn', `document.querySelectorAll('#tag-results a').length===${n}`); }
const response = await fetch(new URL('/tags/', base)); assert(response.ok);
const html = await response.text();
const list = html.match(/<ul id="tag-results"[^>]*>([\s\S]*?)<\/ul>/)?.[1];
assert(list, 'Server HTML must contain tag results');
const serverLinks = [...list.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);
assert(serverLinks.length > 0);
assert.match(html, /<div hidden=""[^>]*><label[^>]*for="tag-name-query"/);
try {
 for (const width of [390,1280]) {
  b('set','viewport',String(width),'844'); b('open',new URL('/tags/',base).href); ready();
  const original=entries(); assert.deepEqual(original.map(x=>x.href),serverLinks);
  for (const query of ['cloud native',' CLOUD   Native ']) {
   b('fill',input,query);count(1);assert.match(entries()[0].text,/#Cloud Native5/);
  }
  b('fill',input,'');b('type',input,'Cloud Native');count(1);
  assert.equal(evaluate(`document.querySelector('${input}').value`),'Cloud Native');
  b('screenshot',`/tmp/blog-tags-${width}.png`);
  assert.equal(evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  // Keyboard navigation through reset to the actual matching link.
  b('press','Tab');assert.equal(evaluate('document.activeElement.textContent'),'초기화');
  b('press','Tab');assert.match(evaluate('document.activeElement.textContent'),/#Cloud Native5/);
  b('press','Enter');b('wait','--fn',`document.querySelector('h1')?.textContent.includes('Cloud Native')`);
  assert.equal(decodeURIComponent(evaluate('location.pathname')),'/tags/Cloud Native/');
  b('open',new URL('/tags/',base).href);ready();b('fill',input,'CI/CD');count(1);
  b('click','#tag-results a');b('wait','--fn',`document.querySelector('h1')?.textContent.includes('CI/CD')`);
  assert.equal(decodeURIComponent(evaluate('location.pathname')),'/tags/CI/CD/');
  b('open',new URL('/tags/',base).href);ready();
  b('fill',input,'.*不存在');count(0);assert(evaluate(`document.querySelector('main').textContent.includes('일치하는 태그가 없습니다')`));
  b('press','Tab');b('press','Enter');count(original.length);
  assert.equal(evaluate('document.activeElement.id'),'tag-name-query');assert.deepEqual(entries(),original);
  b('fill',input,'   ');count(original.length);
  // Synthetic long-name layout fixture; original content remains unchanged.
  evaluate(`document.querySelector('#tag-results a span').textContent='긴태그'.repeat(100)`);
  assert.equal(evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  console.log(`${width}px: search, empty/reset/focus, keyboard, space/slash links, full-list metadata and long-name layout passed`);
 }
 console.log(`Server HTML contains ${serverLinks.length} links and hides inactive search controls without JavaScript`);
} finally { b('close'); }
