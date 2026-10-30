# Worklog

## 2026-10-29 - Verify npm delivery and recent-change checks

**What changed**: Verified the public npm registry serves version 2.0.0, matching the committed package version. Both full maintenance runs found this version already up to date. No new upload ran. The prior publication-pending status is resolved by the registry check.

**Decisions made**: Reused this session's passing `npm test` result: 28 root/Worker tests, with zero failures. No source changed in this documentation update.

**Left off at**: The existing Worker deployment and rollback receipt remain as recorded below; no new Worker deployment or credentialed Parcel operation ran. The final full maintenance run passed all eight stages.

**Open questions**: Still open: Signed-in client/tool acceptance remains unverified.

---

## 2026-10-28 - Adapter security patch and existing Worker update

**What changed**: Updated the root `@hono/node-server` lock entry from 2.1.0 to 2.1.5 for [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f); the Worker lock already had 2.1.5. Version 2.0.0 corrects the declared Node minimum to 20, which the existing adapter already required, and aligns the server, host manifests and README. CI keeps its Node 20 and 22 checks, and runs for source, release metadata and test changes.

**Verification**: All 28 root/Worker tests, the local stdio catalog, release consistency, Worker bundle and both audits pass with zero vulnerabilities. Every GitHub job passed on `b8204be`, including the public carrier catalog and packed-install probes. No credentialed Parcel operation ran.

**Left off at**: Source `b8204be` is deployed to the existing `parcel-mcp-connector` at 100% as `f5209efb-2bc2-4958-b08b-1b6335798d04`. Rollback is `c186934d-fd26-4005-adde-8392020033af`. Eight unauthenticated edge probes pass: health/landing, missing and bad bearer tokens, hostile and allowed origins, and OAuth/resource metadata. PKCE is S256 only and security headers are present. Runtime settings, migration tag, variables and all binding identities match the previous version. Public npm publication remains part of the final release workflow; signed-in client/tool acceptance remains unverified.

---

## 2026-10-23 - Security review

**What changed**: `e922b96` makes the hosted consent form check `ALLOWED_PARCEL_KEY_HASHES` before validating a submitted key with Parcel. Before, anyone could drive unthrottled Parcel requests through the Worker and learn whether a key was valid. `711feb1` moves the root lockfile to zod 4.6.7 (GHSA-mrhx-c7xc-m3w5) and `body-parser` 2.4.0 (GHSA-27r3-jxmh-p828). The Worker bundles the root `index.js` with the root zod, so this also covers the hosted connector's tool validation.

**Verification**: `npm test` passed 23 root and Worker tests, including a new one that fails against the old handler. `release:check`, `smoke:list-tools`, the Worker bundle dry run, and both production audits passed with 0 vulnerabilities.

**Left off at**: Both fixes reach parcel.amesvt.com only after a Worker deploy, and the npm package only after a release.

---

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
