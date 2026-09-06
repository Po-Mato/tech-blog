import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContent } from './validate-content.mjs';

describe('content publication guard', () => {
  it('identifies a file with missing metadata instead of silently publishing it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-metadata-'));
    try {
      await fs.writeFile(path.join(dir, 'missing.md'), '# No frontmatter');
      await expect(validateContent(dir)).rejects.toThrow('missing.md: Invalid publication date');
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });
  it('rejects duplicate public routes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-metadata-'));
    try {
      const raw = '---\ntitle: Test\ndate: 2026-09-02\nslug: same\ndescription: Summary\n---\nBody';
      await fs.writeFile(path.join(dir, 'a.md'), raw);
      await fs.writeFile(path.join(dir, 'b.md'), raw);
      await expect(validateContent(dir)).rejects.toThrow('Duplicate slug: same');
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });
});
