# Cloudflare Workers deployment

tinyship builds to a Cloudflare Worker with Static Assets. Task data uses the `DB` D1 binding.

## 1. Create and bind D1

```bash
npx wrangler d1 create kanby-db --location apac
export CF_D1_DATABASE_ID="<database id>"
export CF_D1_DATABASE_NAME="kanby-db"
CF_D1_DATABASE_ID="$CF_D1_DATABASE_ID" \
  CF_D1_DATABASE_NAME="$CF_D1_DATABASE_NAME" \
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
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

Set `GITHUB_CLIENT_ID`, `PUBLIC_APP_ORIGIN`, and optional
`ALLOWED_GITHUB_LOGINS` as Worker variables. Keep `GITHUB_CLIENT_SECRET` and
`SESSION_SECRET` as Worker secrets.

## 3. Build and deploy

```bash
CF_D1_DATABASE_ID="$CF_D1_DATABASE_ID" \
CF_D1_DATABASE_NAME="kanby-db" \
CF_WORKER_NAME="kanby" \
CF_CUSTOM_DOMAIN="kanby.dev" \
PUBLIC_APP_ORIGIN="https://kanby.dev" \
npm run deploy:cloudflare
```

The generated deployment configuration is `dist/server/wrangler.json`. Never commit `.env.local` or GitHub secrets.
