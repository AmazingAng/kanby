# Kanby

Kanby is a minimal, agent-native kanban board for one-to-three-person software teams. Humans, coding agents, and GitHub activity share the same task history instead of maintaining separate sources of truth.

> **Project status:** early beta. Kanby is running in production, but the self-hosting interface and database migrations may still evolve between releases.

[Live service](https://kanby.dev) · [Demo](https://kanby.dev/demo) · [Kanby CLI](https://github.com/AmazingAng/kanby-cli)

## Features

- Drag-and-drop task boards built with dnd-kit
- Projects, board slugs, invitations, multiple assignees, due dates, subtasks, acceptance checklists, attachments, archive, and deletion
- Markdown task descriptions and image previews backed by Cloudflare R2
- GitHub OAuth sign-in and GitHub App access to public or private repositories
- Issue import, task/PR linking, status automation, CI failure signals, webhook deduplication, retry, and recovery sync
- Task activity timeline for people, coding agents, and GitHub events
- Agent Tokens plus a JSON API for claim, progress, checklist, link, and completion workflows
- A zero-dependency CLI and Codex skill maintained in the separate [`kanby-cli`](https://github.com/AmazingAng/kanby-cli) repository

## Architecture

```text
Browser / Kanby CLI / coding agent
                 │
                 ▼
      Vinext application on
        Cloudflare Workers
          │           │
          ▼           ▼
     Cloudflare D1   Cloudflare R2
       task data       attachments
          │
          ▼
 GitHub OAuth + GitHub App webhooks/API
```

The application uses React 19 and Vinext, with route handlers under `app/api`. D1 schema definitions live in `db/schema.ts`; append-only SQL migrations live in `drizzle/`. The browser API uses a signed session cookie, while coding agents use revocable project-scoped Agent Tokens.

Important directories:

| Path                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `app/`               | Pages and Worker API routes                                    |
| `components/`        | Kanban, gateway, settings, and shared UI                       |
| `db/` and `drizzle/` | D1 schema and migrations                                       |
| `lib/`               | Authentication, persistence, GitHub automation, and task rules |
| `packages/cli/`      | In-tree CLI copy used by integration tests                     |
| `skills/kanby/`      | In-tree coding-agent skill copy                                |
| `tests/`             | Unit, integration, property, and concurrency tests             |
| `tools/`             | Build hooks and the release gauntlet                           |

## Local development

### Prerequisites

- Node.js 22.13 or newer
- npm
- A Cloudflare account only when deploying remotely
- A GitHub OAuth App when testing sign-in
- A GitHub App when testing repository automation

Install the pinned dependency tree:

```bash
npm ci
```

Create a local Worker variables file. `.dev.vars` and every `.env*` file are ignored by Git.

```bash
cp .env.example .dev.vars
```

At minimum, configure a GitHub OAuth App with this callback for the local origin you use:

```text
http://localhost:5173/api/auth/github/callback
```

Set `PUBLIC_APP_ORIGIN` to that exact origin. Generate a local session secret with `openssl rand -base64 32`. Never reuse production credentials in development.

Build the Worker once and initialize its local D1 database:

```bash
npm run build
npx wrangler d1 migrations apply DB --local \
  --config dist/server/wrangler.json
```

Start the development server:

```bash
npm run dev
```

The public `/demo` route is useful for UI work that does not require GitHub authentication.

### Checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Before opening a pull request, run the complete release gate:

```bash
npm run gauntlet
```

It covers tests, enforced coverage, types, lint, formatting, mutation checks, the production dependency audit, worktree and Git-history secret scanning, randomized test order, a production Worker build, and scheduled recovery configuration.

## GitHub integration

GitHub OAuth authenticates Kanby users. Repository access is deliberately handled by a separate GitHub App so each installation can grant access to selected public or private repositories without storing a long-lived installation token.

The GitHub App needs read-only access to Contents, Issues, Pull requests, Actions, and Metadata. Subscribe it to Push, Issues, Pull request, and Workflow run events. See [the Cloudflare deployment guide](docs/CLOUDFLARE_DEPLOY.md) for exact URLs and environment variables.

## Cloudflare deployment

Kanby targets Cloudflare Workers with a `DB` D1 binding and an `ATTACHMENTS` R2 binding. The generated Worker configuration is intentionally excluded from Git because account IDs and custom-domain settings belong to each deployment.

Follow [docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md) to create resources, apply migrations, configure secrets, and deploy. Never commit a generated PEM private key or paste credentials into an issue, pull request, build log, or support discussion.

## Agent and CLI API

Project members can create named, revocable Agent Tokens from Kanby settings. The token is shown once and is stored only as a hash. See [docs/AGENT_API.md](docs/AGENT_API.md) for the HTTP contract, or install the supported CLI and skill from [`AmazingAng/kanby-cli`](https://github.com/AmazingAng/kanby-cli).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending a change. Security issues must follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## License

Kanby’s server and web application are licensed under the [GNU Affero General Public License v3.0 only](LICENSE). The separately distributed Kanby CLI is MIT licensed; its license is included in `packages/cli/LICENSE` and in the standalone CLI repository.
