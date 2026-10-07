import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8812';
const session = `reading-${process.pid}`;
const path = '/posts/2026-09-02-proactive-update/';
const slug = '2026-09-02-proactive-update';
const key = 'blog-reading-position-v1';
function b(...args) {
 const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));
 assert(r.success,r.error);return r.data;
}
const e=js=>b('eval',js).result;
const open=p=>{b('open',new URL(p,base).href);b('reload');b('wait','.code-copy-toolbar button');};
const visible=()=>e('!document.querySelector("[data-reading-position]").hidden');
const stored=()=>e(`JSON.parse(localStorage.getItem('${key}')||'[]')`);
try {
 for(const width of [390,1280]) {
  b('set','viewport',String(width),'844');open(path);
  e(`localStorage.removeItem('${key}')`);b('reload');b('wait','.code-copy-toolbar button');assert(!visible());
  const target=e("document.querySelectorAll('.prose h2[id],.prose h3[id]')[3].id");
  const href=e(`Array.from(document.querySelectorAll('.post-toc a')).find(a=>decodeURIComponent(a.hash).slice(1)===${JSON.stringify(target)}).getAttribute('href')`);
  b('click',`.post-toc a[href="${href}"]`);
  b('wait','--fn',`JSON.parse(localStorage.getItem('${key}')||'[]').some(p=>p.heading===${JSON.stringify(target)})`);
  assert.equal(stored()[0].slug,slug);
  open('/posts/2026-08-28-proactive-update/');assert(!visible());
  open(path);assert(visible());assert.equal(e('location.hash'),'');assert(e('document.querySelector(".prose h2").getBoundingClientRect().top>100'));
  e("document.querySelector('[data-reading-position]').scrollIntoView({block:'center'})");
  b('screenshot',`/tmp/reading-${width}.png`);
  e("document.querySelector('[data-resume]').focus()");b('press',width===390?'Enter':'Space');
  assert.equal(e('decodeURIComponent(location.hash).slice(1)'),target);
  assert.equal(e('document.activeElement.id'),target);
  assert(e(`document.getElementById(${JSON.stringify(target)}).getBoundingClientRect().top>=60`));
  b('back');assert.equal(e('location.hash'),'');b('forward');assert.equal(e('decodeURIComponent(location.hash).slice(1)'),target);
  open(path+href);assert(!visible());assert.equal(stored()[0].heading,target);
  open(path);
  e("window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')}");
  b('click','[data-erase]');assert(visible());assert(e("document.querySelector('[data-reading-position] [role=status]').textContent.includes('삭제하지 못했습니다')"));
  e('Storage.prototype.setItem=window.__set');
  b('click','[data-erase]');assert(!visible());assert.equal(stored().length,0);
  assert(e("document.activeElement.matches('.post-toc summary')"));
  b('reload');b('wait','.code-copy-toolbar button');assert(!visible());assert.equal(stored().length,0);
  console.log(`${width}px: 선택 이동·주소·삭제 검증 완료`);
  // Move keyboard focus to the reading surface instead of the independently scrollable TOC.
  e("const prose=document.querySelector('.prose');prose.tabIndex=-1;prose.focus({preventScroll:true})");
  // Real keyboard scroll arms subsequent position capture.
  for(let step=0;step<6;step++) b('press','PageDown');
  b('wait','--fn',`JSON.parse(localStorage.getItem('${key}')||'[]').length>0`);
  assert(e('document.body.scrollWidth<=innerWidth'));
  for(const raw of ['{', JSON.stringify([{slug,heading:'section-deleted',updatedAt:1}])]) {
   e(`localStorage.setItem('${key}',${JSON.stringify(raw)})`);b('reload');b('wait','.code-copy-toolbar button');assert(!visible());
  }
  // Simulate denied storage for the next client-side article mount, without changing the server.
  e(`window.__get=Storage.prototype.getItem;Storage.prototype.getItem=function(){throw new DOMException('Denied','SecurityError')}`);
  b('click','article > a[href="/"]');b('wait','--url',new URL('/',base).href);
  b('click',`a[href="${path}"]`);b('wait','.code-copy-toolbar button');assert(!visible());
  e('Storage.prototype.getItem=window.__get');
  console.log(`${width}px: 재방문·선택 이동·포커스·이력·fragment·삭제·키보드 읽기·손상/삭제 문단·저장소 차단 통과`);
 }
} finally {b('close');}
