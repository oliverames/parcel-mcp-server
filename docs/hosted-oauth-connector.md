# Hosted Cloudflare connector

The Worker exposes an OAuth 2.1 protected Streamable HTTP endpoint at `/mcp` and a legacy SSE endpoint at `/sse`.

## Architecture

- `OAuthProvider` handles dynamic client registration, authorization grants, and connector tokens.
- `ParcelHandler` displays consent, validates a Parcel API key, and stores it encrypted.
- `ParcelMCP` imports `createParcelServer()` from the root module, so local and hosted clients receive the same tools.
- `OAuthTransientState` stores single-use authorization and deletion state with a ten-minute expiry.
- Cloudflare KV stores OAuth records and encrypted Parcel API keys.

The connector uses separate `COOKIE_ENCRYPTION_KEY` and `DATA_ENCRYPTION_KEY` secrets. AES-GCM authenticates each encrypted record with its storage key as additional data.

## Provision and deploy

```bash
cd /path/to/parcel-mcp-server
npm ci
npm ci --prefix worker
cd worker
npx wrangler kv namespace create PARCEL_OAUTH_KV
```

Put the resulting namespace ID in `wrangler.jsonc`, then set two independent random secrets:

```bash
openssl rand -base64 48 | npx wrangler secret put COOKIE_ENCRYPTION_KEY
openssl rand -base64 48 | npx wrangler secret put DATA_ENCRYPTION_KEY
npm test
npm run deploy
```

`ALLOWED_PARCEL_KEY_HASHES` is a comma-separated list of lowercase SHA-256 hashes. Set it for every private deployment so only approved Parcel API keys can authorize the connector. The production deployment at `parcel.amesvt.com` contains only Oliver Ames' key hash.

## Live verification

After deployment:

```bash
curl -i https://parcel.amesvt.com/health
curl -i https://parcel.amesvt.com/mcp
curl -i -H 'Origin: https://hostile.example' https://parcel.amesvt.com/mcp
```

Expected results are 200 for health, 401 for unauthenticated MCP, and 403 for a hostile browser origin. All responses must include the configured security headers.
