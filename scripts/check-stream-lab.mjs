import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2]||'http://localhost:8814';
const session=`stream-${process.pid}`;
const names=['stream-lab.go','stream-lab_test.go'];
const expected=names.map(n=>readFileSync('public/examples/'+n,'utf8'));
const dir=mkdtempSync(join(tmpdir(),'published-stream-'));
function b(...args){const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));assert(r.success,r.error);return r.data;}
const e=s=>b('eval',s).result;
try{
 const types=[];
 for(const [i,n] of names.entries()){
  const r=await fetch(new URL('/examples/'+n,base));assert(r.ok);types.push(r.headers.get('content-type')||'');
  const text=await r.text();assert.equal(text,expected[i]);writeFileSync(join(dir,n),text);
 }
 const opts={cwd:dir,encoding:'utf8',timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}};
 assert.equal(execFileSync('go',['run','stream-lab.go'],opts),'2\n4\n6\n완료: 입력 종료와 출력 종료 확인\n');
 execFileSync('go',['test','-race','-count=10','-timeout=30s',...names],opts);
 for(const width of [390,1280]){
  b('set','viewport',String(width),'844');b('open',new URL('/posts/2026-08-29-proactive-update/',base).href);b('wait','[data-code-copy]');
  const toc=e(`[...document.querySelectorAll('.post-toc a')].find(a=>a.textContent.includes('로컬 실습:')).getAttribute('href')`);
  b('click',`.post-toc a[href="${toc}"]`);assert.equal(e('location.hash'),toc);
  e(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}})`);
  for(const [i,n] of names.entries()){
   assert.equal(e(`document.querySelectorAll('pre > code')[${i}].textContent`),expected[i]);
   b('click',`button[aria-label="${i+1}번째 코드 블록 줄바꿈"]`);
   b('click',`button[aria-label="${i+1}번째 코드 블록 복사"]`);assert.equal(e('window.__copied'),expected[i]);
   assert(e(`document.querySelectorAll('pre')[${i}].scrollWidth<=document.querySelectorAll('pre')[${i}].clientWidth+1`));
   if(types[i].includes('application/octet-stream')){
    const target=join(dir,`download-${i}`);b('download',`a[href="/examples/${n}"]`,target);assert.equal(readFileSync(target,'utf8'),expected[i]);
   }
  }
  assert(e('document.documentElement.scrollWidth<=innerWidth'));
  e(`[...document.querySelectorAll('.prose h2')].find(h=>h.textContent.includes('로컬 실습:')).scrollIntoView({behavior:'instant',block:'center'})`);
  b('screenshot',`/tmp/stream-lab-${width}.png`);
  for(const [i,n] of names.entries()) if(!types[i].includes('application/octet-stream')){
   b('click',`a[href="/examples/${n}"]`);b('wait','--url',new URL('/examples/'+n,base).href);
   assert(e('document.body.textContent.includes("package main")'));
   b('back');b('wait','[data-code-copy]');
  }
  console.log(`${width}px: 본문/다운로드 일치·목차·줄바꿈·복사·파일 이동·넘침 통과`);
 }
 console.log('다운로드 Go 독립 실행·4개 종료 검사·race 10회 통과');
}finally{b('close');rmSync(dir,{recursive:true,force:true});}
