import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
const article=readFileSync(new URL('../content/posts/2026-08-29-proactive-update.md',import.meta.url),'utf8');
const blocks=[...article.matchAll(/```go\n([\s\S]*?)```/g)].map(m=>m[1]);
function run(args, code=blocks[0]){
 const dir=mkdtempSync(join(tmpdir(),'stream-lab-'));
 try{
  writeFileSync(join(dir,'stream-lab.go'),code);writeFileSync(join(dir,'stream-lab_test.go'),blocks[1]);
  const r=spawnSync('go',args,{cwd:dir,encoding:'utf8',timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
  if(r.error)throw r.error;return r;
 }finally{rmSync(dir,{recursive:true,force:true});}
}
it('본문 두 파일과 다운로드 원문이 같다',()=>{
 for(const [i,name] of ['stream-lab.go','stream-lab_test.go'].entries())expect(readFileSync(new URL('../public/examples/'+name,import.meta.url),'utf8')).toBe(blocks[i]);
});
it('독립 실행에서 정상 출력과 종료를 확인한다',()=>{
 const r=run(['run','stream-lab.go']);expect(r.status,r.stderr).toBe(0);expect(r.stdout).toBe('2\n4\n6\n완료: 입력 종료와 출력 종료 확인\n');
},65000);
it('종료 경계 네 검사와 race 반복 검사를 통과한다',()=>{
 const r=run(['test','-race','-count=10','-timeout=30s','stream-lab.go','stream-lab_test.go']);expect(r.status,r.stdout+r.stderr).toBe(0);
},65000);
it('출력 취소 분기를 제거하면 소비자 없는 취소 검사가 실패한다',()=>{
 const old='select {\n\t\t\t\tcase <-ctx.Done():\n\t\t\t\t\treturn\n\t\t\t\tcase out <- result:\n\t\t\t\t}';
 expect(blocks[0]).toContain(old);
 const r=run(['test','-run','TestCancelWithoutOutputConsumer','-timeout=10s','stream-lab.go','stream-lab_test.go'],blocks[0].replace(old,'out <- result'));
 expect(r.status).toBe(1);expect(r.stdout).toContain('처리 goroutine 종료 시간 초과');
},65000);
it('입력 종료 확인을 제거하면 빈 입력 검사가 실패한다',()=>{
 const r=run(['test','-run','TestEmptyInput','-timeout=10s','stream-lab.go','stream-lab_test.go'],blocks[0].replace('value, ok := <-in:', 'value := <-in:').replace(/\n\s*if !ok {\n\s*return\n\s*}/,''));
 expect(r.status).toBe(1);expect(r.stdout).toContain('닫힌 입력에서 값 생성');
},65000);
