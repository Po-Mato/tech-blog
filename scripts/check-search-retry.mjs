import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8813';
const session = `retry-${process.pid}`;
function b(...args) {
 const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));
 assert(r.success,r.error);return r.data;
}
const e=js=>b('eval',js).result;
const input='input[aria-label="검색어"]';
const retry='[data-search-retry]';
const help='[aria-label="검색 탐색 도움"]';
const address='/search/?q=cloud&tag=all&sort=new&source=retry#keep';
function setup(modes) {
 b('open',new URL('/',base).href);b('reload');
 // Intercept only this isolated browser's index request; the server is never changed.
 e(`window.__modes=${JSON.stringify(modes)};window.__count=0;window.__aborts=0;
 const realFetch=window.fetch.bind(window);
 window.fetch=async (url,options)=>{
  if(new URL(typeof url==='string'?url:url.url,location.href).pathname!=='/search-index.json') return realFetch(url,options);
  window.__count++; const mode=window.__modes.shift();
  if(mode==='503') return new Response('',{status:503});
  if(mode==='json') return new Response('{');
  if(mode==='shape') return new Response('{}');
  if(mode==='hold'||mode==='hang') await new Promise((resolve,reject)=>{
   window.__release=resolve;
   options.signal.addEventListener('abort',()=>{window.__aborts++;reject(new DOMException('Aborted','AbortError'));},{once:true});
  });
  return realFetch(url,options);
 };`);
 b('click','main a[href="/search/"]');b('wait',input);
 e(`history.replaceState(null,'',${JSON.stringify(address)});dispatchEvent(new Event('blog-search-change'));`);
 b('wait','[data-search-load] [role="alert"]');
 assert.equal(e(`document.querySelector('${help}')`),null);
}
function ready(){b('wait','--fn',"!document.querySelector('[data-search-load]') && document.querySelectorAll('main li h2 a').length>0");}
try {
 for(const width of [390,1280]) {
  b('set','viewport',String(width),'844');setup(['503','hold']);
  e("history.replaceState(null,'','/search/?q=Rust&tag=Rust&sort=new&source=retry#keep');dispatchEvent(new Event('blog-search-change'))");
  const before=e('({url:location.href,length:history.length})');
  b('screenshot',`/tmp/search-retry-error-${width}.png`);
  e(`document.querySelector('${retry}').focus()`);b('press',width===390?'Enter':'Space');
  b('press','Enter');b('press','Space');
  assert.equal(e('window.__count'),2);assert.equal(e(`document.querySelector('${retry}').getAttribute('aria-disabled')`),'true');
  assert.equal(e(`document.querySelector('${help}')`),null);
  assert.deepEqual(e('({url:location.href,length:history.length})'),before);
  b('screenshot',`/tmp/search-retry-loading-${width}.png`);
  e('window.__release()');ready();
  assert.equal(e('document.activeElement.getAttribute("aria-label")'),'검색어');
  assert.deepEqual(e('({url:location.href,length:history.length})'),before);
  assert.equal(e("document.querySelector('select[aria-label=\"태그 필터\"]').value"),'Rust');
  assert(e('document.body.scrollWidth<=innerWidth'));
  setup(['503','json','shape','hold']);
  for(const attempt of [2,3]) {b('click',retry);b('wait','[data-search-load] [role="alert"]');assert.equal(e('window.__count'),attempt);}
  b('click',retry);b('fill',input,'React');
  const changed=e('location.href');e('window.__release()');ready();
  assert.equal(e('location.href'),changed);assert.equal(e(`document.querySelector('${input}').value`),'React');
  assert.equal(e('window.__count'),4);
  console.log(`${width}px: 503·JSON·자료 오류 복구, Enter/Space·중복 차단·조건/이력·포커스·대기 중 검색어 변경 통과`);
 }
 setup(['503','hold']);b('click',retry);
 // User explicitly moves focus while waiting; success must not steal it.
 e("document.querySelector('select[aria-label=\"정렬 방식\"]').focus()");
 e('window.__release()');ready();assert.equal(e('document.activeElement.tagName'),'SELECT');
 setup(['503','hang']);b('click',retry);b('wait','[data-search-load] [role="alert"]');
 assert.equal(e('window.__aborts'),1);b('click',retry);ready();
 setup(['503','hold']);b('click',retry);
 b('click','header nav a[href="/"]');b('wait','--url',new URL('/',base).href);
 assert.equal(e('window.__aborts'),1);e('window.__release()');
 assert.equal(e(`document.querySelector('${retry}')`),null);
 console.log('15초 시간 초과→재시도·다른 포커스 보존·페이지 이탈 취소 통과');
} finally {b('close');}
