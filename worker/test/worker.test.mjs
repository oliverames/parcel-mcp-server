import assert from "node:assert/strict";
import test from "node:test";
import { allowedMcpOrigins, rejectUntrustedMcpOrigin } from "../src/mcp-origin.js";
import { applyTransportSecurityHeaders } from "../src/response-security.js";
import { decryptStoredJson, encryptStoredJson, grantedScopes, hmacSign, hmacVerify, isAllowedKeyHash, requestedScopes, sha256, validateParcelApiKey } from "../src/parcel-credentials.js";
import { consentPage, layout, messagePage } from "../src/pages.js";
import { ParcelHandler } from "../src/parcel-handler.js";

const env = { CONNECTOR_BASE_URL: "https://parcel.amesvt.com", MCP_ALLOWED_ORIGINS: "https://chatgpt.com,https://claude.ai", COOKIE_ENCRYPTION_KEY: "cookie-key-at-least-thirty-two-bytes", DATA_ENCRYPTION_KEY: "data-key-at-least-thirty-two-bytes!!" };
const request = (url, headers = {}) => new Request(url, { headers });

test("origin allowlist includes connector and configured clients", () => { const origins = allowedMcpOrigins(env); assert.ok(origins.has("https://parcel.amesvt.com")); assert.ok(origins.has("https://claude.ai")); });
test("native MCP requests without Origin are allowed", () => assert.equal(rejectUntrustedMcpOrigin(request("https://parcel.amesvt.com/mcp"), env), null));
test("trusted browser Origin is allowed", () => assert.equal(rejectUntrustedMcpOrigin(request("https://parcel.amesvt.com/mcp", { Origin: "https://claude.ai" }), env), null));
test("hostile browser Origin is rejected", () => assert.equal(rejectUntrustedMcpOrigin(request("https://parcel.amesvt.com/mcp", { Origin: "https://evil.example" }), env).status, 403));
test("Origin carrying a path is rejected", () => assert.equal(rejectUntrustedMcpOrigin(request("https://parcel.amesvt.com/mcp", { Origin: "https://claude.ai/path" }), env).status, 403));
test("HTTPS responses include transport security headers", () => { const response = applyTransportSecurityHeaders(request("https://parcel.amesvt.com/"), new Response("ok")); assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff"); });
test("encrypted API key round-trips and binds to storage key", async () => { const sealed = await encryptStoredJson(env.DATA_ENCRYPTION_KEY, "parcel:key:a:b", { api_key: "secret" }); assert.ok(!sealed.includes("secret")); assert.deepEqual(await decryptStoredJson(env.DATA_ENCRYPTION_KEY, "parcel:key:a:b", sealed), { api_key: "secret" }); await assert.rejects(() => decryptStoredJson(env.DATA_ENCRYPTION_KEY, "parcel:key:a:c", sealed)); });
test("consent signature is payload-specific", async () => { const signature = await hmacSign(env.COOKIE_ENCRYPTION_KEY, "a"); assert.equal(await hmacVerify(env.COOKIE_ENCRYPTION_KEY, "a", signature), true); assert.equal(await hmacVerify(env.COOKIE_ENCRYPTION_KEY, "b", signature), false); });
test("key hashes are stable and allowlist is enforced", async () => { const hash = await sha256("key"); assert.equal(hash, await sha256("key")); assert.equal(isAllowedKeyHash({ ALLOWED_PARCEL_KEY_HASHES: hash }, hash), true); assert.equal(isAllowedKeyHash({ ALLOWED_PARCEL_KEY_HASHES: "deadbeef" }, hash), false); assert.equal(isAllowedKeyHash({}, hash), true); });
test("write access requires both the requested scope and user consent", () => {
  assert.deepEqual(requestedScopes("read write write unknown"), ["read", "write"]);
  assert.deepEqual(grantedScopes("read", true), ["read"]);
  assert.deepEqual(grantedScopes("read write", false), ["read"]);
  assert.deepEqual(grantedScopes("read write", true), ["read", "write"]);
});
test("API key validation uses the active endpoint and manual redirects", async () => { let call; const payload = await validateParcelApiKey("secret", async (url, options) => { call = { url, options }; return new Response(JSON.stringify({ success: true, deliveries: [] }), { status: 200 }); }); assert.equal(payload.success, true); assert.equal(call.url, "https://api.parcel.app/external/deliveries/?filter_mode=active"); assert.equal(call.options.headers["api-key"], "secret"); assert.equal(call.options.redirect, "manual"); });
test("HTML escapes untrusted client content", () => { const html = consentPage({ clientName: '<img src=x onerror="x">', payload: "p", signature: "s" }); assert.ok(!html.includes("<img src=x")); assert.ok(html.includes("&lt;img")); assert.ok(!messagePage("x", "<script>x</script>").includes("<script>")); assert.match(layout("x", "body"), /noindex/); });
test("consent shows requested scopes and never offers unrequested write access", () => {
  const readOnly = consentPage({ clientName: "client", payload: "p", signature: "s", requestedScopes: ["read"] });
  assert.match(readOnly, /Requested access: <strong>read<\/strong>/);
  assert.doesNotMatch(readOnly, /name="allow_writes"/);
  const readWrite = consentPage({ clientName: "client", payload: "p", signature: "s", requestedScopes: ["read", "write"] });
  assert.match(readWrite, /name="allow_writes"/);
});
test("a key outside the allowlist is refused before Parcel is called", async () => {
  const payload = btoa(JSON.stringify({ clientId: "c", redirectUri: "https://client.example/cb", scope: ["read"] }));
  const signature = await hmacSign(env.COOKIE_ENCRYPTION_KEY, payload);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Parcel must not be called"); };
  try {
    const response = await ParcelHandler.request("https://parcel.amesvt.com/authorize", {
      method: "POST",
      body: new URLSearchParams({ payload, signature, api_key: "someone-elses-key" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }, { ...env, ALLOWED_PARCEL_KEY_HASHES: await sha256("owner-key") });
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("health, privacy, and icon routes are public", async () => { assert.equal((await ParcelHandler.request("https://parcel.amesvt.com/health", {}, env)).status, 200); assert.equal((await ParcelHandler.request("https://parcel.amesvt.com/privacy", {}, env)).status, 200); const icon = await ParcelHandler.request("https://parcel.amesvt.com/icon.svg", {}, env); assert.equal(icon.status, 200); assert.match(icon.headers.get("content-type"), /image\/svg\+xml/); });
