import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.argv[2] || 'http://localhost:8812';
const session=`wrap-${process.pid}`;
function b(...args){const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));assert(r.success,r.error);return r.data;}
const e=s=>b('eval',s).result;
const wrap='button[data-code-wrap]';
const first='button[aria-label="1번째 코드 블록 줄바꿈"]';
const path='/posts/2026-09-02-proactive-update/';
try {
 for(const width of [320,390,1280]){
  b('set','viewport',String(width),'844');b('open',new URL(path,base).href);b('reload');b('wait',wrap);
  e('window.__original=[...document.querySelectorAll("pre > code")].map(c=>c.textContent)');
  assert(e(`[...document.querySelectorAll('${wrap}')].every(b=>b.getAttribute('aria-pressed')==='false')`));
  e(`document.querySelector('${first}').focus()`);b('press','Enter');
  assert(e(`document.activeElement===document.querySelector('${first}') && document.activeElement.getAttribute('aria-pressed')==='true'`));
  assert(e(`document.querySelectorAll('${wrap}')[1].getAttribute('aria-pressed')==='false'`));
  // Every real block (YAML, Python, JSON, shell), plus one long-token fixture.
  const count=e(`document.querySelectorAll('${wrap}').length`);
  for(let i=1;i<count;i++) b('click',`button[aria-label="${i+1}번째 코드 블록 줄바꿈"]`);
  assert(e('JSON.stringify(window.__original)===JSON.stringify([...document.querySelectorAll("pre > code")].map(c=>c.textContent))'));
  assert(e('[...document.querySelectorAll("pre")].every(p=>p.scrollWidth<=p.clientWidth+1)'));
  e(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}})`);
  for(let i=0;i<count;i++){
   b('click',`button[aria-label="${i+1}번째 코드 블록 복사"]`);
   assert(e(`window.__copied===window.__original[${i}]`));
  }
  e(`document.querySelector('pre > code').textContent='  한글 & <tag>\\n\\t'+ 'x'.repeat(500)+'\\n'`);
  assert(e('document.querySelector("pre").scrollWidth<=document.querySelector("pre").clientWidth+1'));
  b('click','button[aria-label="1번째 코드 블록 복사"]');
  assert(e('window.__copied===document.querySelector("pre > code").textContent'));
  e(`document.querySelector('${first}').focus()`);b('press','Space');
  assert(e(`document.activeElement.getAttribute('aria-pressed')==='false' && getComputedStyle(document.querySelector('pre')).whiteSpace==='pre'`));
  b('press','Space');
  assert(e('document.documentElement.scrollWidth<=innerWidth'));
  e('document.querySelector("pre > code").textContent=window.__original[0];document.querySelectorAll("pre")[1].previousElementSibling.scrollIntoView()');
  b('screenshot',`/tmp/code-wrap-${width}.png`);
  b('click','.post-toc li:last-child a');assert.equal(e('decodeURIComponent(location.hash)'),'#section-요약');
  b('click','article > a[href="/"]');b('wait','--url',new URL('/',base).href);
  assert.equal(e(`document.querySelectorAll('${wrap}').length`),0);
  b('open',new URL(path,base).href);b('wait',wrap);
  assert(e(`document.querySelectorAll('${wrap}').length===document.querySelectorAll('pre > code').length`));
  assert(e(`[...document.querySelectorAll('${wrap}')].every(b=>b.getAttribute('aria-pressed')==='false')`));
  console.log(`${width}px: 블록별 토글·키보드·포커스·원문/복사·긴 토큰·넘침·목차·재방문 통과`);
 }
} finally {b('close');}
