# Cloudflare Workers deployment

tinyship builds to a Cloudflare Worker with Static Assets. Task data uses the `DB` D1 binding.

## 1. Create and bind D1

```bash
npx wrangler d1 create tinyship
export CF_D1_DATABASE_ID="<database id>"
npx wrangler d1 migrations apply tinyship --remote
```

## 2. Configure GitHub OAuth

Create a GitHub OAuth App and set its callback URL to:

```text
https://<your-domain>/api/auth/github/callback
```

Configure Worker secrets and variables:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ALLOWED_GITHUB_LOGINS
```

Set `PUBLIC_APP_ORIGIN` to the exact HTTPS origin in the Cloudflare dashboard or generated Wrangler configuration.

## 3. Build and deploy

```bash
CF_D1_DATABASE_ID="$CF_D1_DATABASE_ID" npm run deploy:cloudflare
```

The generated deployment configuration is `dist/server/wrangler.json`. Never commit `.env.local` or GitHub secrets.
