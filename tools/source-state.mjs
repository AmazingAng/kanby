import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', [
  'ls-files',
  '-co',
  '--exclude-standard',
  '-z',
])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter(
    (file) =>
      !file.endsWith('-evidence.md') &&
      !file.startsWith('coverage/') &&
      !file.startsWith('dist/'),
  )
  .sort();

const digest = createHash('sha256');
for (const file of files) {
  digest.update(`${file}\0`);
  digest.update(readFileSync(file));
  digest.update('\0');
}

process.stdout.write(`${digest.digest('hex')} ${files.length}\n`);
