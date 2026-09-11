import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/support/cloudflare-workers.ts', import.meta.url),
      ),
      'next/server': 'vinext/shims/server',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'components/task-markdown.tsx',
        'lib/agent-token-policy.ts',
        'lib/github-access.ts',
        'lib/github-automation.ts',
        'lib/github-ci.ts',
        'lib/request-limits.ts',
        'lib/settings-project.ts',
        'lib/task-activity.ts',
        'lib/task-due.ts',
        'lib/task-subtasks.ts',
        'lib/task-sync.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});
