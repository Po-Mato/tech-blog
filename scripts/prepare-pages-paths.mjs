import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Next exports an encoded slash as a literal %2F directory. GitHub Pages
// decodes %2F before resolving files, so it also needs the nested directory.
// Copy the full route (including RSC payloads) to support client navigation.
export async function preparePagesPaths(outDir = path.join(process.cwd(), 'out')) {
  const tagsDir = path.resolve(outDir, 'tags');
  let count = 0;
  for (const entry of await fs.readdir(tagsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/%2f/i.test(entry.name)) continue;
    const decoded = entry.name.replace(/%2f/gi, '/');
    const target = path.resolve(tagsDir, decoded);
    if (!target.startsWith(tagsDir + path.sep)) throw new Error(`Unsafe tag path: ${entry.name}`);
    await fs.cp(path.join(tagsDir, entry.name), target, { recursive: true });
    count++;
  }
  console.log(`GitHub Pages paths prepared: ${count} slash-containing tags`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await preparePagesPaths();
