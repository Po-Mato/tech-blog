import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.argv[2]||'http://localhost:8816';
const session=`month-${process.pid}`;
function b(...args){const r=JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));assert(r.success,r.error);return r.data;}
const e=s=>b('eval',s).result;
const clean=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const get=async p=>{const r=await fetch(new URL(p,base));assert(r.ok,p);return clean(await r.text());};
const docs=(await (await fetch(new URL('/search-index.json',base))).json()).docs.filter(d=>d.type==='post');
const months=[...new Set(docs.map(d=>d.date.slice(0,7)))].sort().reverse();
const index=await get('/archive/month/');const sitemap=await get('/sitemap.xml');
let total=0;
for(const month of months){
 const path=`/archive/month/${month}/`;assert(index.includes(`href="${path}"`));assert(sitemap.includes(`https://po-mato.github.io${path}`));
 const html=await get(path);const expected=docs.filter(d=>d.date.startsWith(month));
 assert(html.includes(`rel="canonical" href="https://po-mato.github.io${path}"`));
 assert.equal((html.match(/<time /g)||[]).length,expected.length);
 for(const d of expected)assert(html.includes(`href="/posts/${d.slug}/"`));
 total+=expected.length;
}
assert.equal(total,docs.length);
for(const path of ['/archive/month/2026-13/','/archive/month/1900-01/'])assert.equal((await fetch(new URL(path,base))).status,404);
assert((await get('/archive/2/')).includes('월별로 보기'));
try{
 for(const width of [390,1280]){
  b('set','viewport',String(width),'844');b('open',new URL('/',base).href);
  b('click','main a[href="/archive/month/"]');b('wait','h1');
  e('document.querySelector("a[href=\\"/archive/month/2026-08/\\"]").focus()');b('press','Enter');
  b('wait','--url',new URL('/archive/month/2026-08/',base).href);
  assert.equal(e('document.querySelectorAll("main time").length'),29);
  assert(e('document.documentElement.scrollWidth<=innerWidth'));
  b('screenshot',`/tmp/month-list-${width}.png`);
  const href=e('document.querySelector("main h3 a").getAttribute("href")');b('click',`main h3 a[href="${href}"]`);b('wait','--url',new URL(href,base).href);
  b('back');b('wait','--url',new URL('/archive/month/2026-08/',base).href);b('reload');assert.equal(e('document.querySelectorAll("main time").length'),29);
  b('click','main nav a[href="/archive/month/"]');b('screenshot',`/tmp/month-index-${width}.png`);
  for(const month of ['2025-12','2026-09']){
   b('click',`main a[href="/archive/month/${month}/"]`);b('wait','--url',new URL(`/archive/month/${month}/`,base).href);assert.equal(e('document.querySelectorAll("main time").length'),2);
   b('click','main nav a[href="/archive/month/"]');
  }
  b('click','main a[href="/"]');b('wait','--url',new URL('/',base).href);
  console.log(`${width}px: 홈·월 선택 Enter·29편·글 이동·뒤로·새로고침·연도 경계·전체 복귀 통과`);
 }
 console.log(`${months.length}개월 ${total}편 서버 HTML·canonical·사이트맵·없는 월 404 통과`);
}finally{b('close');}
