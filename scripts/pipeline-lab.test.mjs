import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
const article = readFileSync(new URL('../content/posts/2026-09-02-proactive-update.md', import.meta.url), 'utf8');
const code = article.match(/```python\n([\s\S]*?)```/)[1];
const valid = {service:'demo-api',environment:'staging',tests_passed:true};
function run(raw, approve = true) {
 const dir=mkdtempSync(path.join(tmpdir(),'blog-pipeline-lab-'));
 try {
  writeFileSync(path.join(dir,'pipeline-lab.py'),code);
  if(raw!==null)writeFileSync(path.join(dir,'request.json'),raw);
  // -I isolates Python from user packages and environment. Only the published code is copied.
  const r=spawnSync('python3',['-I','pipeline-lab.py','request.json',...(approve?['--approve']:[])],{cwd:dir,encoding:'utf8',timeout:5000});
  if(r.error)throw r.error;
  expect(r.stderr).toBe('');
  return {exit:r.status, output:JSON.parse(r.stdout)};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
it('keeps downloadable source identical to the executable article block',()=>{
 expect(readFileSync(new URL('../public/examples/pipeline-lab.py',import.meta.url),'utf8')).toBe(code);
});
it('halts valid input before approval',()=>{
 expect(run(JSON.stringify(valid),false)).toEqual({exit:3,output:{status:'approval_required',message:'검토 후 --approve로 다시 실행하세요.'}});
});
it('only simulates deployment after approval',()=>{
 expect(run(JSON.stringify(valid))).toEqual({exit:0,output:{status:'simulated',service:'demo-api',environment:'staging',deployed:false}});
});
it('approval cannot override environment or service policy',()=>{
 for(const patch of [{environment:'production'},{service:'other-api'}]){
  const r=run(JSON.stringify({...valid,...patch}));expect(r.exit).toBe(2);expect(r.output.status).toBe('rejected');
 }
});
it('rejects false and truthy non-boolean test results',()=>{
 for(const value of [false,1,'true',[],null]){
  const r=run(JSON.stringify({...valid,tests_passed:value}));expect(r.exit).toBe(2);expect(r.output.status).toBe('rejected');
 }
});
it('rejects missing, extra or non-object input fields',()=>{
 for(const value of [{service:'demo-api'},{...valid,extra:true},[],null]){
  const r=run(JSON.stringify(value));expect(r.exit).toBe(2);expect(r.output.status).toBe('invalid');
 }
});
it('handles invalid JSON and missing files without a traceback',()=>{
 for(const raw of ['{',null]){
  const r=run(raw);expect(r.exit).toBe(2);expect(r.output.status).toBe('invalid');
 }
});
