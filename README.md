# Parcel MCP Server

[![CI](https://github.com/oliverames/parcel-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/oliverames/parcel-mcp-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@oliverames/mcp-server-for-parcel)](https://www.npmjs.com/package/@oliverames/mcp-server-for-parcel)

An MCP server for [Parcel](https://parcelapp.net/) delivery tracking. It covers every field and operation in Parcel's documented external API, provides the daily carrier catalog, and runs through local stdio or a hosted Cloudflare remote connector.

This project is not affiliated with Ivan Pavlov or Parcel.

## Coverage

| Parcel API | MCP tools |
| --- | --- |
| `GET /external/deliveries/` with `active` and `recent` | `parcel_list_deliveries`, `parcel_get_delivery` |
| `POST /external/add-delivery/` with all seven request fields | `parcel_add_delivery` |
| `GET /external/supported_carriers.json` | `parcel_list_carriers`, `parcel_find_carriers` |

Parcel does not document edit, delete, archive, or forced-refresh endpoints. This server does not claim those capabilities.

## Tools

- `parcel_auth_status` reports credential discovery and the write gate without an API call.
- `parcel_list_deliveries` returns every delivery and event from the `active` or `recent` API view.
- `parcel_get_delivery` selects one exact tracking number from those API views.
- `parcel_list_carriers` returns the complete carrier code map.
- `parcel_find_carriers` searches carrier names and codes.
- `parcel_add_delivery` submits one delivery and supports `tracking_number`, `carrier_code`, `description`, `language`, `send_push_confirmation`, `postcode`, and `email`.

The add tool is not advertised unless `PARCEL_ALLOW_WRITES=1`. This prevents an MCP client from invoking a write when the server was intended to be read-only.

## Parcel API limits

- Parcel Premium is required.
- Delivery reads return cached data and do not trigger a carrier refresh.
- Reads are limited to 20 requests per hour.
- Adds are limited to 20 requests per day, including failed requests.
- The add endpoint accepts one delivery per request.
- Newly added deliveries can show no data until Parcel's next server update.

## Local installation

Generate an API key at [Parcel Web Access](https://web.parcelapp.net/), then use one of these credential methods:

```bash
export PARCEL_API_KEY="your-parcel-api-key"
export PARCEL_ALLOW_WRITES=1
npx -y @oliverames/mcp-server-for-parcel@latest
```

The server also supports:

- `PARCEL_API_KEY_FILE`, a small file containing only the key.
- `PARCEL_OP_PATH`, an `op://` reference read through the 1Password CLI.
- Codex `~/.codex/config.toml` and Claude `~/.claude/settings.json` environment sections.

Credential priority is the process environment, host configuration, key file, then 1Password. The server never sends the key outside `https://api.parcel.app` and refuses redirects.

### Claude Desktop, Claude Code, Codex, Hermes, and Antigravity

The repository includes native manifests for each host. The generic configuration is:

```json
{
  "mcpServers": {
    "parcel-mcp-server": {
      "command": "npx",
      "args": ["-y", "@oliverames/mcp-server-for-parcel@latest"],
      "env": {
        "PARCEL_API_KEY": "${PARCEL_API_KEY}",
        "PARCEL_OP_PATH": "${PARCEL_OP_PATH}",
        "PARCEL_ALLOW_WRITES": "1"
      }
    }
  }
}
```

Leave `PARCEL_ALLOW_WRITES` empty for a read-only server.

### Error reporting

Error reporting is off by default. If you set `SENTRY_DSN`, the local server sends unexpected tool failures, Parcel 5xx responses, and fatal errors to that Sentry project; without it, `@sentry/node` is never loaded. Reporting needs Node 20.19 or newer and is skipped quietly on older runtimes.

Each report carries only the error type, a fixed message, stack frames with package-relative paths, the tool name, and the HTTP status of a failed Parcel response. Tracking numbers, package descriptions, carrier events, locations, postcodes, email addresses, tool arguments, error messages, Parcel responses, breadcrumbs, user data, and request data are removed before anything is sent. A missing API key, an unknown tracking number, and Parcel's own 4xx or validation answers are not reported. The hosted connector does not use this setting.

## Hosted Cloudflare connector

The `worker/` directory provides an OAuth 2.1 protected Streamable HTTP endpoint at `https://parcel.amesvt.com/mcp`, plus legacy SSE for older clients. During authorization, the connector asks for a Parcel API key, validates it against Parcel, encrypts it with AES-GCM, and stores it per connection. The key never enters the connector's OAuth token or MCP Durable Object state.

The connector supports PKCE S256, dynamic client registration, optional write access, origin filtering, separate consent-signing and data-encryption keys, encrypted key deletion, and security headers. See [the deployment guide](docs/hosted-oauth-connector.md).

The production deployment at `parcel.amesvt.com` is private. Cloudflare stores an allowlist containing only the SHA-256 hash of Oliver Ames' Parcel API key, so authorization attempts using any other Parcel key are rejected.

## Development and verification

```bash
npm install
npm test
npm run smoke:list-tools
npm run smoke:live-tool
npm run smoke:packed
npm run release:check
npm pack --dry-run
```

The packed-install test installs the actual tarball and launches both declared bin names through npm's relative symlinks. CI tests Node 18, 20, and 22, audits dependencies, scans secrets, and tests the Worker.

## Security and privacy

See [SECURITY.md](SECURITY.md), [the hosted connector privacy notice](docs/privacy.md), and [Error reporting](#error-reporting) for the optional local Sentry setting. Do not commit Parcel API keys. If one is exposed, revoke it through Parcel Web Access and generate a replacement.

## License

MIT. Copyright 2026 Oliver Ames.
