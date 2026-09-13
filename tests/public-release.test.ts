import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const scanner = join(repositoryRoot, 'tools/check-secrets.mjs');
const temporaryDirectories: string[] = [];

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'kanby-public-release-'));
  temporaryDirectories.push(directory);
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Kanby Test'], {
    cwd: directory,
  });
  execFileSync('git', ['config', 'user.email', 'test@kanby.invalid'], {
    cwd: directory,
  });
  return directory;
}

function runScanner(directory: string) {
  return spawnSync(process.execPath, [scanner, '--repo', directory], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('public release contract', () => {
  it('declares the root application as AGPL-3.0-only', () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { license?: string; name?: string; private?: boolean };
    const license = readFileSync(join(repositoryRoot, 'LICENSE'), 'utf8');

    expect(packageJson.name).toBe('kanby');
    expect(packageJson.license).toBe('AGPL-3.0-only');
    expect(packageJson.private).toBe(true);
    expect(license).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(license).toContain('Version 3, 19 November 2007');
  });

  it('keeps the CLI as a canonical workspace package in this repository', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { workspaces?: string[] };
    const cliPackage = JSON.parse(
      readFileSync(join(repositoryRoot, 'packages/cli/package.json'), 'utf8'),
    ) as {
      name?: string;
      publishConfig?: { access?: string };
      repository?: { url?: string; directory?: string };
    };
    const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');

    expect(rootPackage.workspaces).toContain('packages/*');
    expect(cliPackage.name).toBe('@kanby/cli');
    expect(cliPackage.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/AmazingAng/kanby.git',
      directory: 'packages/cli',
    });
    expect(cliPackage.publishConfig?.access).toBe('public');
    expect(readme).not.toContain('AmazingAng/kanby-cli');
  });

  it('ships the contributor-facing release documents and CI workflow', () => {
    const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');
    const contributing = readFileSync(
      join(repositoryRoot, 'CONTRIBUTING.md'),
      'utf8',
    );
    const security = readFileSync(join(repositoryRoot, 'SECURITY.md'), 'utf8');
    const ci = readFileSync(
      join(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8',
    );

    for (const section of [
      '## Features',
      '## Architecture',
      '## Local development',
      '## Cloudflare deployment',
      '## License',
    ]) {
      expect(readme).toContain(section);
    }
    expect(contributing).toContain('npm run gauntlet');
    expect(security).toContain('privately report');
    expect(ci).toContain('npm run gauntlet');
  });

  it('tracks a placeholder-only environment template while ignoring local credentials', () => {
    const example = readFileSync(join(repositoryRoot, '.env.example'), 'utf8');
    const ignoredExample = spawnSync(
      'git',
      ['check-ignore', '--quiet', '.env.example'],
      { cwd: repositoryRoot },
    );

    expect(ignoredExample.status).toBe(1);
    for (const key of [
      'GITHUB_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'SESSION_SECRET',
    ]) {
      expect(example).toContain(`${key}=\n`);
    }
    expect(example).toContain('CF_R2_BUCKET_NAME=kanby-attachments');
  });

  it('rejects a secret that exists only in reachable Git history', () => {
    const directory = createRepository();
    const secretName = ['GITHUB', 'CLIENT', 'SECRET'].join('_');
    const secretValue = ['synthetic', 'history', '0123456789abcdef'].join('_');
    writeFileSync(
      join(directory, 'config.txt'),
      `${secretName}=${secretValue}\n`,
    );
    execFileSync('git', ['add', 'config.txt'], { cwd: directory });
    execFileSync('git', ['commit', '--quiet', '-m', 'add fixture'], {
      cwd: directory,
    });
    writeFileSync(join(directory, 'config.txt'), 'safe=true\n');
    execFileSync('git', ['add', 'config.txt'], { cwd: directory });
    execFileSync('git', ['commit', '--quiet', '-m', 'remove fixture'], {
      cwd: directory,
    });

    const result = runScanner(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Git history');
    expect(result.stderr).not.toContain(secretValue);
  });

  it('rejects an uncommitted private key without printing its contents', () => {
    const directory = createRepository();
    writeFileSync(join(directory, 'safe.txt'), 'safe=true\n');
    execFileSync('git', ['add', 'safe.txt'], { cwd: directory });
    execFileSync('git', ['commit', '--quiet', '-m', 'safe fixture'], {
      cwd: directory,
    });
    const privateKey = [
      '-----BEGIN ' + 'PRIVATE KEY-----',
      'synthetic-only-not-a-real-key',
      '-----END ' + 'PRIVATE KEY-----',
      '',
    ].join('\n');
    writeFileSync(join(directory, 'private.pem'), privateKey);

    const result = runScanner(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('private.pem:1 (private key)');
    expect(result.stderr).not.toContain('synthetic-only-not-a-real-key');
  });
});
