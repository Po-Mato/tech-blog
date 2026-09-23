import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8799';
const session = `search-url-${process.pid}`;
function b(...args) {
  const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));
  assert(r.success,r.error);return r.data;
}
const input='input[aria-label="검색어"]', tag='select[aria-label="태그 필터"]', sort='select[aria-label="정렬 방식"]';
const value = () => b('eval',`({q:document.querySelector('${input}').value,tag:document.querySelector('${tag}').value,sort:document.querySelector('${sort}').value,url:location.href,length:history.length,links:[...document.querySelectorAll('main li h2 a')].map(a=>a.pathname)})`).result;
function ready(){b('wait','--fn',`document.querySelector('${tag}') && !document.querySelector('${tag}').disabled`);}
function state(q,t,s){b('wait','--fn',`document.querySelector('${input}').value===${JSON.stringify(q)} && document.querySelector('${tag}').value===${JSON.stringify(t)} && document.querySelector('${sort}').value===${JSON.stringify(s)}`);}
try {
  // Optional preview whose /search-index.json response is delayed by at least 5 seconds.
  if (process.argv[3]) {
    b('open',new URL('/search/?q=cloud&tag=Cloud%20Native&sort=new',process.argv[3]).href);
    b('fill',input,'AI');
    assert.equal(value().q,'AI');
    assert.equal(new URL(value().url).searchParams.get('tag'),'Cloud Native');
    ready();state('AI','Cloud Native','new');
    console.log('Input during delayed index load preserves query and pending tag');
  }
  for(const width of [390,1280]){
    b('set','viewport',String(width),'844');b('open',new URL('/search/?q=cloud&tag=Cloud%20Native&sort=new',base).href);ready();state('cloud','Cloud Native','new');
    const before=value();assert(before.links.length>0);
    b('reload');ready();state('cloud','Cloud Native','new');assert.deepEqual(value().links,before.links);
    b('select',tag,'all');state('cloud','all','new');b('select',sort,'relevance');state('cloud','all','relevance');
    b('back');state('cloud','all','new');b('back');state('cloud','Cloud Native','new');b('forward');state('cloud','all','new');
    const n=value().length;
    b('fill',input,'');b('type',input,'fast typing 한글 123');state('fast typing 한글 123','all','new');
    b('fill',input,'AI a');state('AI a','all','new');
    b('fill',input,' 한글 + & # / % ');state(' 한글 + & # / % ','all','new');
    assert.equal(value().length,n);assert.equal(new URL(value().url).searchParams.get('q'),' 한글 + & # / % ');
    const shared=value().url;b('open',shared);ready();state(' 한글 + & # / % ','all','new');
    b('fill',input,'');state('','all','new');assert(!new URL(value().url).searchParams.has('q'));
    b('fill',input,'cloud');b('select',tag,'Cloud Native');b('select',sort,'new');state('cloud','Cloud Native','new');
    b('screenshot',`/tmp/blog-search-url-${width}.png`);
    console.log(`${width}px URL, reload, history, special characters, empty query and input history passed`);
  }
  b('open',new URL('/search/?q=AI&tag=not-a-tag&sort=invalid',base).href);ready();state('AI','all','relevance');
  b('open',new URL('/search/?q=cloud&tag=Cloud-Native&sort=new',base).href);ready();state('cloud','Cloud Native','new');
  // Synthetic composition events supplement normal keyboard typing; not an OS IME test.
  b('eval',`document.querySelector('${input}').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
  b('fill',input,'한글 조합');
  b('eval',`document.querySelector('${input}').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한글 조합'}))`);
  state('한글 조합','Cloud Native','new');
  b('fill',input,'cloud');b('click','main li:first-child h2 a');b('wait','--url','**/posts/**');b('back');ready();state('cloud','Cloud Native','new');
  console.log('Invalid values, aliases, synthetic composition and post navigation restoration passed');
}finally{b('close');}
