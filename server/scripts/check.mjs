import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(root);
const files = [];

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full);
    } else if (entry.isFile() && full.endsWith('.js')) {
      files.push(full);
    }
  }
}

await collect(join(root, 'src'));
await collect(join(root, 'scripts'));
await collect(join(repoRoot, 'shared'));

for (const file of files) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Syntax check failed: ${file}`));
    });
  });
}

console.log(`Checked ${files.length} server files`);
