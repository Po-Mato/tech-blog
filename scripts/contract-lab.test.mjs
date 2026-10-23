import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
const code=readFileSync('public/examples/contract-lab.py','utf8');
function run(source){const dir=mkdtempSync(join(tmpdir(),'contract-'));try{writeFileSync(join(dir,'contract-lab.py'),source);return spawnSync('python3',['-I','contract-lab.py'],{cwd:dir,encoding:'utf8',timeout:5000});}finally{rmSync(dir,{recursive:true,force:true});}}
it('본문과 다운로드 코드가 같다',()=>{expect(readFileSync('content/posts/2026-09-01-proactive-update.md','utf8').match(/```python\n([\s\S]*?)```/)[1]).toBe(code);});
it('정상과 모든 오류 fixture를 독립 실행한다',()=>{const r=run(code);expect(r.error).toBeUndefined();expect(r.status).toBe(0);expect(r.stderr).toContain('Ran 3 tests');expect(r.stderr).toContain('OK');});
it('상태 코드만 검사하는 결함을 검출한다',()=>{const r=run(code.replace('    try:\n','    return {}\n    try:\n'));expect(r.error).toBeUndefined();expect(r.status).toBe(1);expect(r.stderr).toContain('FAILED');});
