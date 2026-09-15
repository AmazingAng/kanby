# Cloudflare Workers deployment

Kanby builds to a Cloudflare Worker with Static Assets. Task data uses the `DB` D1 binding and attachments use the `ATTACHMENTS` R2 binding.

## 0. Prepare the checkout

Use Node.js 22.13 or newer and install the exact dependency tree:

```bash
npm ci
```

Keep build-time identifiers in an ignored `.env.local` file or in your shell. Keep runtime secrets in Cloudflare Worker secrets. Do not use production credentials in local development.

## 1. Create and bind D1

```bash
npx wrangler d1 create kanby-db --location apac
npx wrangler r2 bucket create kanby-attachments
export CF_D1_DATABASE_ID="<database id>"
export CF_D1_DATABASE_NAME="kanby-db"
export CF_R2_BUCKET_NAME="kanby-attachments"
CF_D1_DATABASE_ID="$CF_D1_DATABASE_ID" \
  CF_D1_DATABASE_NAME="$CF_D1_DATABASE_NAME" \
  CF_R2_BUCKET_NAME="$CF_R2_BUCKET_NAME" \
  npm run build
npx wrangler d1 migrations apply DB --remote \
  --config dist/server/wrangler.json
```

## 2. Configure GitHub OAuth

Create a GitHub OAuth App and set its callback URL to:

```text
https://kanby.dev/api/auth/github/callback
```

Configure Worker secrets and variables:

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET --name kanby
npx wrangler secret put SESSION_SECRET --name kanby
```

Generate `SESSION_SECRET` from at least 32 random bytes (for example,
`openssl rand -base64 32`). Kanby rejects shorter values. Production
`PUBLIC_APP_ORIGIN` values must use HTTPS and contain only the origin—no
credentials, path, query, or fragment. Plain HTTP is accepted only on loopback
hosts for local development.

When the application is served below a shared host path, set
`PUBLIC_APP_BASE_PATH` to that exact route prefix. For example, an xAPI preview
served at `/w/702a5b1647a3/preview` uses the dispatch host as
`PUBLIC_APP_ORIGIN` and that prefix as `PUBLIC_APP_BASE_PATH`. Leave it empty
when the application has a dedicated hostname. OAuth callbacks, redirects, and
authentication cookies all use this path.

Set `GITHUB_CLIENT_ID`, `PUBLIC_APP_ORIGIN`, and optional access rules as Worker
variables. `ALLOWED_GITHUB_LOGINS` accepts comma-separated GitHub usernames or
verified email addresses. `ALLOWED_GITHUB_ORGS` accepts organization names, and
`ALLOWED_GITHUB_TEAMS` accepts `org/team-slug` values. A user matching any rule
can sign in; with no rules configured, any GitHub account can sign in. Keep
`GITHUB_CLIENT_SECRET` and `SESSION_SECRET` as Worker secrets.

## 3. Build and deploy

```bash
CF_D1_DATABASE_ID="$CF_D1_DATABASE_ID" \
CF_D1_DATABASE_NAME="kanby-db" \
CF_R2_BUCKET_NAME="kanby-attachments" \
CF_WORKER_NAME="kanby" \
CF_CUSTOM_DOMAIN="kanby.dev" \
PUBLIC_APP_ORIGIN="https://kanby.dev" \
npm run deploy:cloudflare
```

The generated deployment configuration is `dist/server/wrangler.json`. Never commit `.env.local` or GitHub secrets.

## 4. Connect repositories with a GitHub App

The OAuth App above is only for signing in. Create a separate GitHub App for
repository activity. Replace `<public-base-url>` below with
`PUBLIC_APP_ORIGIN` plus `PUBLIC_APP_BASE_PATH` when a base path is configured:

- Homepage URL: `<public-base-url>`
- Setup URL: `<public-base-url>/api/github/setup` (redirect after installation)
- Webhook URL: `<public-base-url>/api/github/webhook`
- Webhook secret: a new random secret
- Repository permissions: Contents `Read-only`, Issues `Read-only`, Pull
  requests `Read-only`, Actions `Read-only`, and Metadata `Read-only`
- Subscribe to: Push, Issues, Pull request, and Workflow run

The App can be installed for selected repositories, including private ones.
Set `GITHUB_APP_ID` and `GITHUB_APP_SLUG` as non-secret Worker variables during
the build. Store the private key and webhook signing secret with Wrangler:

```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --name kanby
npx wrangler secret put GITHUB_WEBHOOK_SECRET --name kanby
```

Paste the complete GitHub-generated PEM file into `GITHUB_APP_PRIVATE_KEY`.
Kanby generates short-lived installation tokens at request time; it does not
store installation access tokens in D1.

## 5. Verify the deployment

Before publishing a new revision, run `npm run gauntlet`. After deployment,
verify the home page, `/demo`, GitHub sign-in, project creation, one attachment,
and the GitHub App diagnostic in project settings. Apply every new D1 migration
before sending production traffic to code that expects it.

GitHub App connection is a sensitive action. If the browser session is older
than 15 minutes, Kanby asks the owner to authenticate with GitHub again before
starting installation. This refreshes organization-administrator claims rather
than trusting a month-old membership snapshot.

To roll back application code, deploy a previously known-good commit. D1
migrations are append-only; create a forward repair migration instead of
editing or deleting a migration that may already have run.
