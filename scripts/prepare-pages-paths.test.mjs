import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePagesPaths } from './prepare-pages-paths.mjs';

describe('GitHub Pages encoded slash paths', () => {
  it('preserves the encoded export and supplies decoded HTML and RSC paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-paths-'));
    try {
      const source = path.join(dir, 'tags', 'CI%2FCD');
      await fs.mkdir(source, { recursive: true });
      await fs.writeFile(path.join(source, 'index.html'), '<h1>CI/CD</h1>');
      await fs.writeFile(path.join(source, '__next._tree.txt'), 'route payload');
      await preparePagesPaths(dir);
      expect(await fs.readFile(path.join(dir, 'tags/CI/CD/index.html'), 'utf8')).toBe('<h1>CI/CD</h1>');
      expect(await fs.readFile(path.join(dir, 'tags/CI/CD/__next._tree.txt'), 'utf8')).toBe('route payload');
      expect(await fs.readFile(path.join(source, 'index.html'), 'utf8')).toBe('<h1>CI/CD</h1>');
    } finally { await fs.rm(dir, { recursive: true }); }
  });
});
