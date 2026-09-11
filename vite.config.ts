import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;
const isDirectCloudflareDeploy = Boolean(process.env.CF_D1_DATABASE_ID);
const workerName = process.env.CF_WORKER_NAME ?? 'kanby';
const customDomain = process.env.CF_CUSTOM_DOMAIN?.trim();

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const runtimeVars = Object.fromEntries(
  [
    'GITHUB_CLIENT_ID',
    'GITHUB_APP_ID',
    'GITHUB_APP_SLUG',
    'PUBLIC_APP_ORIGIN',
    'ALLOWED_GITHUB_LOGINS',
    'ALLOWED_GITHUB_ORGS',
    'ALLOWED_GITHUB_TEAMS',
  ]
    .map((key) => [key, process.env[key]] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
);

const localBindingConfig = {
  name: workerName,
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  vars: runtimeVars,
  routes:
    isDirectCloudflareDeploy && customDomain
      ? [{ pattern: customDomain, custom_domain: true }]
      : [],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: process.env.CF_D1_DATABASE_NAME ?? 'site-creator-d1',
          database_id:
            process.env.CF_D1_DATABASE_ID ??
            SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          // The Cloudflare Vite plugin rewrites this path relative to
          // dist/server/wrangler.json during build.
          migrations_dir: 'drizzle',
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: process.env.CF_R2_BUCKET_NAME ?? 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
