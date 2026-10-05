import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:8811';
const session = `pipeline-lab-${process.pid}`;
const expected = readFileSync('public/examples/pipeline-lab.py', 'utf8');
function browser(...args) {
  const response = JSON.parse(execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8', timeout: 45000 }));
  assert(response.success, response.error);
  return response.data;
}
const evaluate = js => browser('eval', js).result;
try {
  const response = await fetch(new URL('/examples/pipeline-lab.py', base));
  assert(response.ok);
  const downloaded = await response.text();
  assert.equal(downloaded, expected);
  const directory = mkdtempSync(join(tmpdir(), 'published-lab-'));
  try {
    writeFileSync(join(directory, 'pipeline-lab.py'), downloaded);
    writeFileSync(join(directory, 'request.json'), JSON.stringify({ service: 'demo-api', environment: 'staging', tests_passed: true }));
    const result = JSON.parse(execFileSync('python3', ['-I', 'pipeline-lab.py', 'request.json', '--approve'], { cwd: directory, encoding: 'utf8' }));
    assert.equal(result.status, 'simulated');
    assert.equal(result.deployed, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const width of [390, 1280]) {
    browser('set', 'viewport', String(width), '844');
    browser('open', new URL('/posts/2026-09-02-proactive-update/', base).href);
    browser('wait', '.code-copy-toolbar button');
    const toc = evaluate(`Array.from(document.querySelectorAll('.post-toc a')).find(a => a.textContent.includes('로컬 실습:')).getAttribute('href')`);
    browser('click', `.post-toc a[href="${toc}"]`);
    assert.equal(evaluate('location.hash'), toc);
    assert(evaluate('document.body.scrollWidth <= innerWidth'));
    const block = evaluate(`Array.from(document.querySelectorAll('pre > code')).findIndex(c => c.textContent.includes('def report('))`);
    assert(block >= 0);
    assert.equal(evaluate(`document.querySelectorAll('pre > code')[${block}].textContent`), expected);
    // Isolated clipboard test double validates the exact text passed by the UI.
    evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });`);
    browser('click', `button[aria-label="${block + 1}번째 코드 블록 복사"]`);
    assert.equal(evaluate('window.__copied'), expected);
    assert(evaluate(`document.querySelectorAll('.code-copy-toolbar [role="status"]')[${block}].textContent.includes('복사했습니다')`));
    browser('click', `.post-toc a[href="${toc}"]`);
    browser('screenshot', `/tmp/pipeline-lab-${width}.png`);
    browser('click', 'a[href="/examples/pipeline-lab.py"]');
    browser('wait', '--url', new URL('/examples/pipeline-lab.py', base).href);
    assert(evaluate("document.body.textContent.includes('def report(')"));
  }
  console.log('공개 예제 다운로드·독립 실행·본문 일치·390/1280px 목차·복사·파일 링크·가로 넘침 검사 통과');
} finally { browser('close'); }
