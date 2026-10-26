import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.argv[2]||'http://127.0.0.1:8826';
const session=`tag-query-${process.pid}`;
function b(...args){const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));assert(r.success,r.error);return r.data;}
const e=js=>b('eval',js).result;
const input='#tag-name-query';
const ready=()=>b('wait','--fn',`document.querySelector('${input}') && !document.querySelector('${input}').closest('[hidden]')`);
const value=q=>b('wait','--fn',`document.querySelector('${input}').value===${JSON.stringify(q)}`);
try{
 for(const width of [390,1280]){
  b('set','viewport',String(width),'844');
  b('open',base+'/tags/?x=1&q=cloud&q=ignored#tag-results');ready();value('cloud');
  const count=e("document.querySelectorAll('#tag-results a').length");assert(count>0);
  b('reload');ready();value('cloud');
  b('fill',input,'CI/CD');value('CI/CD');assert.equal(e("new URLSearchParams(location.search).get('q')"),'CI/CD');
  assert.equal(e("new URLSearchParams(location.search).get('x')"),'1');assert.equal(e('location.hash'),'#tag-results');
  const href=e("document.querySelector('#tag-results a').getAttribute('href')");b('click',`#tag-results a[href="${href}"]`);b('back');ready();value('CI/CD');
  const n=e('history.length');b('click','section[aria-label="태그 찾기"] button');value('');assert(e('history.length')>=n);assert(e(`document.activeElement===document.querySelector('${input}')`));
  b('back');value('CI/CD');b('forward');value('');const cleared=e('history.length');b('click','section[aria-label="태그 찾기"] button');assert.equal(e('history.length'),cleared);
  for(const q of [' 한글 / % & + ','cloud']){b('fill',input,q);assert.equal(e("new URLSearchParams(location.search).get('q')"),q);b('reload');ready();value(q);}
  e(`document.querySelector('${input}').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}))`);b('fill',input,'한글');e(`document.querySelector('${input}').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한글'}))`);value('한글');assert.equal(e("new URLSearchParams(location.search).get('q')"),'한글');b('fill',input,'cloud');e('window.scrollTo(0,0)');assert(e('document.body.scrollWidth<=innerWidth'));b('screenshot',`/tmp/tag-query-${width}.png`);
  console.log(`${width}px 주소·공유 진입·새로고침·태그 왕복·초기화·이력·포커스·특수문자 통과`);
 }
}finally{b('close');}
