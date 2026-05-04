import { readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

async function collectTestFiles(entry) {
  const absoluteEntry = resolve(entry);
  const entryStat = await stat(absoluteEntry);

  if (entryStat.isFile()) {
    return absoluteEntry.endsWith('.test.js') ? [absoluteEntry] : [];
  }

  if (!entryStat.isDirectory()) {
    return [];
  }

  const children = await readdir(absoluteEntry, { withFileTypes: true });
  const nested = await Promise.all(
    children.map((child) => collectTestFiles(join(absoluteEntry, child.name))),
  );

  return nested.flat();
}

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('Usage: node tools/run-node-tests.mjs <test-dir-or-file> [...]');
  process.exit(1);
}

const files = (await Promise.all(targets.map((target) => collectTestFiles(target))))
  .flat()
  .sort();

if (files.length === 0) {
  console.error(`No .test.js files found in: ${targets.join(', ')}`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Test process exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
