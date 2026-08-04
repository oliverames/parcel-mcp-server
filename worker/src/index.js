import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { CONNECTOR_RESOURCE_METADATA } from "./brand-assets.js";
import { rejectUntrustedMcpOrigin } from "./mcp-origin.js";
import { OAuthTransientState } from "./oauth-transient-state.js";
import { ParcelHandler } from "./parcel-handler.js";
import { ParcelMCP } from "./parcel-mcp.js";
import { applyTransportSecurityHeaders } from "./response-security.js";

export { ParcelMCP, OAuthTransientState };
const provider = new OAuthProvider({
  apiHandlers: { "/mcp": ParcelMCP.serve("/mcp"), "/sse": ParcelMCP.serveSSE("/sse") },
  defaultHandler: ParcelHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read", "write"],
  resourceMetadata: CONNECTOR_RESOURCE_METADATA,
  allowPlainPKCE: false,
});
export default { async fetch(request, env, ctx) { const response = rejectUntrustedMcpOrigin(request, env) || await provider.fetch(request, env, ctx); return applyTransportSecurityHeaders(request, response); } };
