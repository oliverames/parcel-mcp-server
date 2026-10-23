import { Hono } from "hono";
import { ICON_SVG } from "./brand-assets.js";
import { consentPage, deletePage, landingPage, layout, messagePage, privacyPage } from "./pages.js";
import { deleteApiKeys, grantedScopes, hmacSign, hmacVerify, isAllowedKeyHash, randomToken, requestedScopes, saveApiKey, sha256, validateParcelApiKey } from "./parcel-credentials.js";

const app = new Hono();
function stateStub(env, id) { return env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName(id)); }
async function putState(env, id, value) { await stateStub(env, id).fetch(`https://state/${id}`, { method: "PUT", body: JSON.stringify(value), headers: { "Content-Type": "application/json" } }); }
async function takeState(env, id) { const response = await stateStub(env, id).fetch(`https://state/${id}`, { method: "DELETE" }); return response.ok ? response.json() : null; }

app.get("/", (c) => c.html(layout("Parcel MCP connector", landingPage(c.env.CONNECTOR_BASE_URL))));
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/privacy", (c) => c.html(layout("Privacy", privacyPage())));
app.get("/icon.svg", () => new Response(ICON_SVG, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'; sandbox", "Access-Control-Allow-Origin": "*" } }));

app.get("/authorize", async (c) => {
  let oauthRequest;
  let client;
  try {
    oauthRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    if (!oauthRequest.clientId) throw new Error("missing client id");
    client = await c.env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  } catch {
    return c.html(layout("Invalid request", messagePage("Invalid request", "The authorization request is malformed or references an unknown client. PKCE S256 is required.")), 400);
  }
  const payload = btoa(JSON.stringify(oauthRequest));
  const signature = await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, payload);
  return c.html(layout("Connect Parcel", consentPage({ clientName: client?.clientName || client?.clientId || "an MCP client", payload, signature, requestedScopes: requestedScopes(oauthRequest.scope) })));
});

app.post("/authorize", async (c) => {
  const form = await c.req.formData();
  const payload = String(form.get("payload") || "");
  const signature = String(form.get("signature") || "");
  const apiKey = String(form.get("api_key") || "").trim();
  const allowWrites = form.get("allow_writes") === "1";
  if (!(await hmacVerify(c.env.COOKIE_ENCRYPTION_KEY, payload, signature))) return c.html(layout("Invalid request", messagePage("Invalid request", "This consent form could not be verified. Start again from the MCP client.")), 400);
  if (!apiKey) return c.html(layout("Connection failed", messagePage("Connection failed", "A Parcel API key is required.")), 400);
  let oauthRequest;
  try { oauthRequest = JSON.parse(atob(payload)); } catch { return c.html(layout("Invalid request", messagePage("Invalid request", "The authorization payload is invalid.")), 400); }
  const requested = requestedScopes(oauthRequest.scope);
  const granted = grantedScopes(requested, allowWrites);
  if (granted.length === 0) return c.html(layout("Connection failed", messagePage("Connection failed", "The client did not request a supported scope.")), 400);
  const writesEnabled = granted.includes("write");
  // Check the allowlist before Parcel sees the key, so this public form cannot
  // be used to make unthrottled Parcel requests or to test arbitrary keys.
  const keyHash = await sha256(apiKey);
  if (!isAllowedKeyHash(c.env, keyHash)) return c.html(layout("Not authorized", messagePage("Not authorized", "This private connector does not allow that Parcel API key.")), 403);
  try { await validateParcelApiKey(apiKey); } catch (error) { return c.html(layout("Connection failed", messagePage("Parcel rejected the API key", error.message)), 401); }
  const tokenKey = randomToken(16);
  await saveApiKey(c.env.OAUTH_KV, keyHash, tokenKey, apiKey, c.env.DATA_ENCRYPTION_KEY);
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({ request: oauthRequest, userId: keyHash, metadata: { label: "Parcel" }, scope: granted, props: { parcelKeyHash: keyHash, tokenKey, writesEnabled } });
  return Response.redirect(redirectTo, 302);
});

app.get("/delete", async (c) => { const csrf = randomToken(24); await putState(c.env, `delete:${csrf}`, { issued: true }); return c.html(layout("Delete connection", deletePage(csrf))); });
app.post("/delete", async (c) => {
  const form = await c.req.formData();
  const csrf = String(form.get("csrf") || "");
  const apiKey = String(form.get("api_key") || "").trim();
  if (!(await takeState(c.env, `delete:${csrf}`))) return c.html(layout("Invalid request", messagePage("Invalid request", "This form expired. Reload and try again.")), 400);
  if (!apiKey) return c.html(layout("Nothing to delete", messagePage("Nothing to delete", "Enter the Parcel API key used for the connection.")), 400);
  const deleted = await deleteApiKeys(c.env.OAUTH_KV, await sha256(apiKey));
  return c.html(layout("Deleted", messagePage("Connection deleted", `Removed ${deleted} stored Parcel credential record(s).`)));
});

app.notFound((c) => c.html(layout("Not found", messagePage("Not found", "The requested connector page does not exist.")), 404));
export const ParcelHandler = app;
