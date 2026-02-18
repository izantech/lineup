import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, generateAllHostFiles } from './host-file-utils.mjs';

const files = generateAllHostFiles();
const mismatches = [];

for (const file of files) {
  const absolutePath = path.join(ROOT, file.target);
  let existing = null;

  try {
    existing = readFileSync(absolutePath, 'utf8');
  } catch {
    mismatches.push({ file, reason: 'missing' });
    continue;
  }

  if (existing !== file.content) {
    mismatches.push({ file, reason: 'out-of-sync' });
  }
}

if (mismatches.length > 0) {
  console.error('Generated host files are out of sync:');
  for (const mismatch of mismatches) {
    console.error(`- [${mismatch.reason}] ${mismatch.file.target} (${mismatch.file.host})`);
  }
  console.error('\nRun: node scripts/sync-host-files.mjs');
  process.exit(1);
}

console.log(`All generated host files are in sync (${files.length} files checked).`);
