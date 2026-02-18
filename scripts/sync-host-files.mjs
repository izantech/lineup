import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, generateAllHostFiles } from './host-file-utils.mjs';

const files = generateAllHostFiles();
let written = 0;
let unchanged = 0;

for (const file of files) {
  const absolutePath = path.join(ROOT, file.target);
  let existing = null;

  try {
    existing = readFileSync(absolutePath, 'utf8');
  } catch {
    existing = null;
  }

  if (existing === file.content) {
    unchanged += 1;
    continue;
  }

  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, file.content, 'utf8');
  written += 1;
  console.log(`updated ${file.target} (${file.host})`);
}

console.log(`\nSync complete: ${written} updated, ${unchanged} unchanged.`);
