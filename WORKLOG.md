# Worklog

## 2026-10-23 - Security dependency updates and connector redeploy

**What changed**: `2a71d76` moved the Worker from `agents ~0.17.4`, which pinned `@modelcontextprotocol/sdk` 1.29.0, to `agents ~0.28.1` with SDK 1.32.1. That clears the SDK session-binding, OAuth credential, cross-origin redirect and request-size advisories, plus `proxy-addr` (critical), `fast-uri`, `qs`, `hono`, `ip-address`, `undici`, `sharp` and `wrangler`. `7df581f` fixed the carrier tools after Parcel changed `supported_carriers.json` values from strings to `{ name }` objects, which had made `parcel_find_carriers` miss display names and `parcel_list_carriers` print `[object Object]`.

**Verification**: Root tests 22/22, Worker tests 14/14, the bundle dry run and the live carrier smoke check passed. On `2a71d76`, CI failed only `live-contract`, on the carrier format change. CI passed every job on `7df581f`, including `live-contract`. Worker version `c186934d-fd26-4005-adde-8392020033af` is deployed at 100% from `7df581f` and replaced `be808f3b-69a7-4c6d-972a-0c2d5196d6da`. After the deploy, `/health` and `/` returned 200, unauthenticated and bad-bearer `/mcp` returned 401 with resource metadata, a hostile `Origin` returned 403, a `claude.ai` `Origin` returned 401, a malformed `/authorize` returned 400, the OAuth metadata advertised S256 only, and HSTS and nosniff were present. A tail of those requests showed every one `ok` with no exceptions.

**Left off at**: No signed-in tool call ran against the new version, so the Agents 0.28.1 Durable Object path is unexercised in production. If a reconnected client misbehaves, roll back to `be808f3b`.

**Open questions**: None.

---

## 2026-08-04 - Initial release and private hosted connector

**What changed**: Created the Parcel MCP server with the complete public Parcel API surface, local stdio support, host manifests, npm and MCPB packaging, and an OAuth 2.1 Cloudflare connector. Published `@oliverames/mcp-server-for-parcel@1.0.0`, GitHub release `v1.0.0`, and the production connector at `https://parcel.amesvt.com/mcp`. Restricted the production connector to Oliver Ames' Parcel API key through a SHA-256 hash allowlist stored as a Cloudflare secret.

**Decisions made**: The add-delivery tool remains hidden unless write access is explicit. Hosted credentials stay encrypted per connection. The public OAuth endpoints may accept client registration, but only the approved Parcel key can complete authorization.

**Left off at**: Commit `8def7b6` was released before this worklog update. All 21 project tests passed during release verification. After the private-access deployment, the authorized Parcel key returned HTTP 200, connector health returned 200, unauthenticated MCP returned 401, hostile browser origin returned 403, and all 14 Worker tests passed. Cloudflare Worker version `be808f3b-69a7-4c6d-972a-0c2d5196d6da` is live.

**Open questions**: None.

---
