import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const patterns = [
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  {
    name: 'private key',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'Kanby token',
    expression:
      /\bkby_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{40,}\b/gi,
  },
  {
    name: 'assigned secret',
    expression:
      /(?:client|github|webhook|session)[_-]?(?:secret|token)\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{24,}/gi,
  },
  {
    name: 'generic assigned secret',
    expression: /\bsecret\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{24,}/gi,
  },
  {
    name: 'authorization bearer',
    expression: /authorization\s*[:=]\s*["']?bearer\s+[A-Za-z0-9._~+/-]{20,}/gi,
  },
];

function findings(source) {
  return patterns.flatMap(({ name, expression }) => {
    expression.lastIndex = 0;
    return [...source.matchAll(expression)].map((match) => ({
      name,
      offset: match.index ?? 0,
    }));
  });
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function repositoryArgument(argv) {
  const index = argv.indexOf('--repo');
  if (index === -1) return process.cwd();
  const repository = argv[index + 1];
  if (!repository || repository.startsWith('--')) {
    throw new Error('--repo requires a repository path');
  }
  return resolve(repository);
}

const negativeControl = 'GITHUB_SECRET="synthetic_only_0123456789abcdef"';
if (findings(negativeControl).length === 0) {
  throw new Error('Secret scanner failed its negative control');
}

const repo = repositoryArgument(process.argv.slice(2));
git(repo, ['rev-parse', '--is-inside-work-tree']);

const files = git(repo, ['ls-files', '-co', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean)
  .filter(
    (file) =>
      !file.endsWith('package-lock.json') &&
      !file.endsWith('tools/check-secrets.mjs') &&
      !file.includes('/fixtures/') &&
      file !== 'tests/support/fixtures.ts',
  );

const detected = [];
for (const file of files) {
  let source;
  try {
    source = readFileSync(resolve(repo, file), 'utf8');
  } catch {
    continue;
  }
  for (const finding of findings(source)) {
    const line = source.slice(0, finding.offset).split('\n').length;
    detected.push(`${file}:${line} (${finding.name})`);
  }
}

const history = git(repo, [
  'log',
  '--all',
  '--format=commit:%H',
  '--no-ext-diff',
  '-p',
  '--',
  '.',
  ':(exclude)package-lock.json',
  ':(exclude)tools/check-secrets.mjs',
  ':(exclude)tests/support/fixtures.ts',
  ':(exclude)**/fixtures/**',
]);

for (const finding of findings(history)) {
  detected.push(`Git history (${finding.name})`);
}

if (detected.length > 0) {
  process.stderr.write(
    `Potential secrets detected (values redacted):\n${detected.join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Secret scan passed for ${files.length} files and reachable Git history; negative control detected.\n`,
);
