# Worklog

## 2026-08-04 - Initial release and private hosted connector

**What changed**: Created the Parcel MCP server with the complete public Parcel API surface, local stdio support, host manifests, npm and MCPB packaging, and an OAuth 2.1 Cloudflare connector. Published `@oliverames/mcp-server-for-parcel@1.0.0`, GitHub release `v1.0.0`, and the production connector at `https://parcel.amesvt.com/mcp`. Restricted the production connector to Oliver Ames' Parcel API key through a SHA-256 hash allowlist stored as a Cloudflare secret.

**Decisions made**: The add-delivery tool remains hidden unless write access is explicit. Hosted credentials stay encrypted per connection. The public OAuth endpoints may accept client registration, but only the approved Parcel key can complete authorization.

**Left off at**: Commit `8def7b6` was released before this worklog update. All 21 project tests passed during release verification. After the private-access deployment, the authorized Parcel key returned HTTP 200, connector health returned 200, unauthenticated MCP returned 401, hostile browser origin returned 403, and all 14 Worker tests passed. Cloudflare Worker version `be808f3b-69a7-4c6d-972a-0c2d5196d6da` is live.

**Open questions**: None.

---
