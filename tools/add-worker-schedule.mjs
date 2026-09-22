import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const serverDir = join(process.cwd(), 'dist', 'server');
const entry = join(serverDir, 'index.js');
const vinextEntry = join(serverDir, 'vinext.js');
const configPath = join(serverDir, 'wrangler.json');
const xapi = process.env.KANBY_XAPI === '1';
const migration = xapi && process.env.KANBY_MIGRATION === '1';
if (xapi)
  await writeFile(
    join(serverDir, 'xapi-scheduled-recovery.js'),
    await readFile('tools/xapi-scheduled-recovery.mjs'),
  );
if (migration)
  await writeFile(
    join(serverDir, 'xapi-migration.js'),
    await readFile('tools/xapi-migration.mjs'),
  );

await rename(entry, vinextEntry);
await writeFile(
  entry,
  `import application from './vinext.js';
${xapi ? "import { scheduledRecovery } from './xapi-scheduled-recovery.js';" : ''}
${migration ? "import { migrationFetch } from './xapi-migration.js';" : ''}

const encoder = new TextEncoder();
async function signature(secret, body) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return 'sha256=' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  fetch(request, env, context) {
    ${migration ? "if (new URL(request.url).pathname === '/__kanby_migration') return migrationFetch(request, env); if (new URL(request.url).pathname !== '/demo' && !new URL(request.url).pathname.startsWith('/_next/')) return new Response('Migration in progress', { status: 503 });" : ''}
    ${xapi ? "if (new URL(request.url).pathname === '/__kanby_recovery') return scheduledRecovery(request, env, context, application);" : ''}
    return application.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    const body = 'kanby-recovery-v1';
    context.waitUntil((async () => {
      if (!env.GITHUB_WEBHOOK_SECRET) return;
      const request = new Request('https://kanby.internal/api/github/recovery', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-kanby-scheduled': '1',
          'x-kanby-signature': await signature(env.GITHUB_WEBHOOK_SECRET, body),
        },
        body,
      });
      const response = await application.fetch(request, env, context);
      if (!response.ok) throw new Error('GitHub recovery cron failed: ' + response.status);
    })());
  },
};
`,
);

const config = JSON.parse(await readFile(configPath, 'utf8'));
config.triggers = { ...config.triggers, crons: ['*/10 * * * *'] };
await writeFile(configPath, `${JSON.stringify(config)}\n`);
