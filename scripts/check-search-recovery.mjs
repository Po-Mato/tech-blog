import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8802';
const session = `search-recovery-${process.pid}`;
function b(...args) {
 const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));
 assert(r.success,r.error); return r.data;
}
const ev = code => b('eval',code).result;
const help='[aria-label="검색 탐색 도움"]';
const input='input[aria-label="검색어"]';
const tag='select[aria-label="태그 필터"]';
const edit=`${help} button:last-of-type`, clear=`${help} button:first-child`;
const url='/search/?q=cloud&tag=Rust&sort=new&source=regression#keep';
function ready(){b('wait','--fn',`document.querySelector('${tag}') && !document.querySelector('${tag}').disabled`);}
function empty(){b('wait',help);assert.equal(ev('document.querySelectorAll("main li h2 a").length'),0);}
function current(){return ev(`({url:location.href,length:history.length,q:document.querySelector('${input}').value,tag:document.querySelector('${tag}').value})`);}
try {
 for(const width of [390,1280]) {
  b('set','viewport',String(width),'844');b('open',new URL(url,base).href);ready();empty();
  const original=current();
  b('click',edit);assert.equal(ev('document.activeElement.getAttribute("aria-label")'),'검색어');assert.deepEqual(current(),original);
  b('screenshot',`/tmp/blog-search-recovery-${width}.png`);
  assert.equal(ev('document.documentElement.scrollWidth>innerWidth'),false);
  // Focus is only test setup; activation must run through the keyboard event.
  ev(`document.querySelector('${clear}').focus()`);b('press',width===390?'Enter':'Space');
  b('wait','--fn',`document.querySelectorAll('main li h2 a').length>0`);
  const after=current();assert.equal(after.q,'cloud');assert.equal(after.tag,'all');assert.equal(after.length,original.length+1);
  const parsed=new URL(after.url);assert.equal(parsed.searchParams.get('sort'),'new');assert.equal(parsed.searchParams.get('source'),'regression');assert.equal(parsed.hash,'#keep');assert(!parsed.searchParams.has('tag'));
  assert.equal(ev('document.activeElement.getAttribute("aria-label")'),'검색어');assert.equal(ev(`document.querySelector('${help}')`),null);
  b('back');empty();assert.equal(current().tag,'Rust');b('forward');b('wait','--fn',`document.querySelectorAll('main li h2 a').length>0`);
  b('back');empty();b('click',`${help} a`);b('wait','#tag-name-query');b('back');ready();empty();assert.equal(current().q,'cloud');assert.equal(current().tag,'Rust');
  b('select',tag,'all');b('fill',input,'zzzznotfound한글');empty();assert.equal(ev(`document.querySelectorAll('${help} button').length`),1);
  const unmatched=current();ev(`document.querySelector('${edit}').focus()`);b('press','Space');assert.equal(ev('document.activeElement.getAttribute("aria-label")'),'검색어');assert.deepEqual(current(),unmatched);
  b('fill',input,'   ');b('wait','--fn',`!document.querySelector('${help}')`);
  b('fill',input,'');b('type',input,'cloud');b('wait','--fn',`document.querySelectorAll('main li h2 a').length>0`);assert.equal(current().q,'cloud');
  console.log(`${width}px: recovery, keyboard, focus, unchanged query, URL/history, topic navigation, empty query and fast input passed`);
 }
 if(process.argv[3]) {
  b('open',new URL(url,process.argv[3]).href);
  assert.equal(ev(`document.querySelector('${tag}').disabled`),true);
  assert.equal(ev(`document.querySelector('${help}')`),null);ready();empty();
  console.log('Delayed index: recovery hidden until loading completes');
 }
 if(process.argv[4]) {
  b('open',new URL(url,process.argv[4]).href);b('wait','[role="alert"]');
  assert.equal(ev(`document.querySelector('${help}')`),null);
  console.log('Failed index: error is not presented as empty results');
 }
} finally {b('close');}
