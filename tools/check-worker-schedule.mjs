import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const serverDir = join(process.cwd(), 'dist', 'server');
const [entry, configText] = await Promise.all([
  readFile(join(serverDir, 'index.js'), 'utf8'),
  readFile(join(serverDir, 'wrangler.json'), 'utf8'),
]);
const config = JSON.parse(configText);
if (!entry.includes('scheduled(_controller, env, context)'))
  throw new Error('Generated Worker is missing its scheduled handler');
if (!entry.includes('/api/github/recovery'))
  throw new Error('Scheduled handler does not invoke GitHub recovery');
if (!config.triggers?.crons?.includes('*/10 * * * *'))
  throw new Error('Generated Worker is missing the GitHub recovery cron');
console.log('Worker recovery schedule verified');
