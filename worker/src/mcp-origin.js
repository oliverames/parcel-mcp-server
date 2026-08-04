const MCP_PATHS = new Set(["/mcp", "/sse"]);
function normalized(value) { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.origin : null; } catch { return null; } }
export function allowedMcpOrigins(env) { return new Set([env.CONNECTOR_BASE_URL, ...(env.MCP_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim())].map(normalized).filter(Boolean)); }
export function rejectUntrustedMcpOrigin(request, env) {
  if (!MCP_PATHS.has(new URL(request.url).pathname)) return null;
  const header = request.headers.get("Origin");
  if (!header) return null;
  if (normalized(header) === header && allowedMcpOrigins(env).has(header)) return null;
  return Response.json({ error: "invalid_origin", error_description: "Browser Origin is not permitted for this MCP endpoint." }, { status: 403, headers: { "Cache-Control": "no-store", Vary: "Origin" } });
}
