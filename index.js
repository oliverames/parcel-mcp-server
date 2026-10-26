#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureFatalError, captureToolError, errorReportingEnabled, flushErrorReporting, initErrorReporting } from "./lib/error-reporting.mjs";

export const VERSION = "1.0.0";
export const PARCEL_API_ORIGIN = "https://api.parcel.app";
export const STATUS_LABELS = Object.freeze({
  0: "delivered",
  1: "frozen",
  2: "in_transit",
  3: "ready_for_pickup",
  4: "out_for_delivery",
  5: "not_found",
  6: "failed_attempt",
  7: "exception",
  8: "information_received",
});

const IS_WORKER = globalThis.navigator?.userAgent === "Cloudflare-Workers";
const RUNTIME_KEYS = ["PARCEL_API_KEY", "PARCEL_API_KEY_FILE", "PARCEL_OP_PATH", "PARCEL_ALLOW_WRITES"];
const MAX_KEY_FILE_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function userHome() {
  return process.env.HOME || homedir();
}

function detectAgent() {
  if (Object.keys(process.env).some((key) => key.startsWith("CODEX_"))) return "codex";
  if (Object.keys(process.env).some((key) => key.startsWith("CLAUDE_"))) return "claude";
  return "unknown";
}

function parseSimpleToml(text) {
  const sections = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      section = heading[1].trim();
      sections[section] ||= {};
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment || !section) continue;
    let value = assignment[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      continue;
    }
    sections[section][assignment[1]] = value;
  }
  return sections;
}

function pickRuntimeValues(source) {
  return Object.fromEntries(RUNTIME_KEYS.filter((key) => hasText(source?.[key])).map((key) => [key, String(source[key]).trim()]));
}

function loadSources() {
  const sources = [{ id: "process_env", label: "process environment", path: null, section: null, available: true, values: pickRuntimeValues(process.env), errors: [] }];
  if (process.env.PARCEL_DISABLE_AGENT_CONFIG_FALLBACK === "1") return sources;

  const codexPath = path.join(userHome(), ".codex", "config.toml");
  try {
    const sections = parseSimpleToml(readFileSync(codexPath, "utf8"));
    for (const section of ["shell_environment_policy.set", "mcp_servers.parcel.env"]) {
      sources.push({ id: `codex_${section}`, label: `Codex ${section}`, path: codexPath, section, available: true, values: pickRuntimeValues(sections[section] || {}), errors: [] });
    }
  } catch (error) {
    sources.push({ id: "codex_config", label: "Codex config", path: codexPath, section: null, available: false, values: {}, errors: error?.code === "ENOENT" ? [] : [error.message] });
  }

  const claudePath = path.join(userHome(), ".claude", "settings.json");
  try {
    const settings = JSON.parse(readFileSync(claudePath, "utf8"));
    sources.push({ id: "claude_settings", label: "Claude settings.json env", path: claudePath, section: "env", available: true, values: pickRuntimeValues(settings?.env || {}), errors: [] });
  } catch (error) {
    sources.push({ id: "claude_settings", label: "Claude settings.json env", path: claudePath, section: "env", available: false, values: {}, errors: error?.code === "ENOENT" ? [] : [error.message] });
  }
  return sources;
}

export function resolveParcelRuntimeConfig() {
  const sources = loadSources();
  const values = {};
  for (const key of RUNTIME_KEYS) {
    const source = sources.find((candidate) => hasText(candidate.values[key]));
    if (source) values[key] = { value: source.values[key], source: source.id, source_label: source.label, path: source.path, section: source.section };
  }

  const errors = sources.flatMap((source) => source.errors || []).filter(Boolean);
  let apiKey = values.PARCEL_API_KEY?.value;
  let keySource = values.PARCEL_API_KEY || null;
  if (!apiKey && values.PARCEL_API_KEY_FILE?.value) {
    try {
      const raw = readFileSync(values.PARCEL_API_KEY_FILE.value, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_KEY_FILE_BYTES) throw new Error(`key file exceeds ${MAX_KEY_FILE_BYTES} bytes`);
      apiKey = raw.trim();
      keySource = { source: "key_file", source_label: "PARCEL_API_KEY_FILE", path: values.PARCEL_API_KEY_FILE.value };
    } catch (error) { errors.push(`Could not read PARCEL_API_KEY_FILE: ${error.message}`); }
  }
  if (!apiKey && values.PARCEL_OP_PATH?.value) {
    const reference = values.PARCEL_OP_PATH.value;
    if (!reference.startsWith("op://")) {
      errors.push("PARCEL_OP_PATH must start with op://");
    } else {
      try {
        apiKey = execFileSync("op", ["read", reference], { encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        keySource = { source: "onepassword_cli", source_label: "PARCEL_OP_PATH via 1Password CLI" };
      } catch (error) {
        errors.push(error?.code === "ENOENT" ? "The 1Password CLI is not installed; set PARCEL_API_KEY instead." : `Could not read PARCEL_OP_PATH: ${error.stderr?.toString().trim() || error.message}`);
      }
    }
  }
  return {
    apiKey,
    keySource,
    writesEnabled: /^(1|true|yes)$/i.test(values.PARCEL_ALLOW_WRITES?.value || ""),
    values,
    sources_checked: sources.map((source) => ({ id: source.id, label: source.label, path: source.path, section: source.section, available: source.available, keys_found: RUNTIME_KEYS.filter((key) => hasText(source.values[key])) })),
    lookup_errors: errors,
    detected_agent: detectAgent(),
    config_fallback_disabled: process.env.PARCEL_DISABLE_AGENT_CONFIG_FALLBACK === "1",
  };
}

function setupGuide(agent) {
  return {
    api_key_url: "https://web.parcelapp.net/",
    environment: { PARCEL_API_KEY: "Parcel API key", PARCEL_ALLOW_WRITES: "Set to 1 to advertise parcel_add_delivery" },
    onepassword: { PARCEL_OP_PATH: "op://Vault/Item/field" },
    detected_agent: agent,
    restart_required: true,
  };
}

function redact(value) {
  return String(value).replace(/(api-key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]").replace(/(PARCEL_API_KEY\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

// Errors the caller can act on (no API key, an unknown tracking number,
// Parcel's own rejection of a request) are not defects and are never
// reported. ParcelApiError carries the HTTP status of a failed response.
class ParcelUserError extends Error {
  name = "ParcelUserError";
}

class ParcelApiError extends Error {
  name = "ParcelApiError";
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Report unexpected failures only: code defects, timeouts, network errors,
// redirects, malformed responses, and Parcel 5xx answers.
function shouldReportToolError(error) {
  if (error instanceof ParcelUserError) return false;
  if (error instanceof ParcelApiError) return !(error.status >= 400 && error.status < 500);
  return true;
}

function normalizeError(error) {
  if (error?.name === "AbortError") return "Parcel API request timed out. Try again.";
  return redact(error?.message || String(error));
}

function textResult(data, markdown) {
  return { content: [{ type: "text", text: markdown || JSON.stringify(data, null, 2) }], structuredContent: data };
}

function errorResult(message) {
  return { isError: true, content: [{ type: "text", text: `Parcel error: ${message}` }] };
}

// Parcel's catalog maps codes to names; since October 2026 each value is { name } instead of a string.
function normalizeCarrierNames(catalog) {
  return Object.fromEntries(Object.entries(catalog).map(([code, value]) => [code, typeof value === "string" ? value : value?.name ?? code]));
}

function addStatusLabels(payload) {
  return {
    ...payload,
    deliveries: Array.isArray(payload.deliveries)
      ? payload.deliveries.map((delivery) => ({ ...delivery, status: STATUS_LABELS[delivery.status_code] || "unknown" }))
      : payload.deliveries,
  };
}

export function createParcelApiClient({ getApiKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A Fetch-compatible implementation is required.");
  async function request(endpoint, { method = "GET", query, body, authenticated = true } = {}) {
    const url = new URL(endpoint, PARCEL_API_ORIGIN);
    if (url.origin !== PARCEL_API_ORIGIN) throw new Error("Refusing to send a Parcel credential outside api.parcel.app.");
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const headers = { Accept: "application/json" };
    if (authenticated) {
      const key = await getApiKey?.();
      if (!hasText(key)) throw new ParcelUserError("PARCEL_API_KEY is not configured. Call parcel_auth_status for setup instructions.");
      headers["api-key"] = key.trim();
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) throw new ParcelApiError(`Refusing Parcel API redirect (${response.status}).`, response.status);
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new ParcelApiError("Parcel API response exceeded the 8 MiB safety limit.", response.status);
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new ParcelApiError(`Parcel API returned non-JSON data (HTTP ${response.status}).`, response.status); }
      const failure = payload.error_message || `Parcel API request failed with HTTP ${response.status}.`;
      if (!response.ok) throw new ParcelApiError(failure, response.status);
      if (payload.success === false) throw new ParcelUserError(failure);
      return payload;
    } finally { clearTimeout(timer); }
  }
  return {
    listDeliveries: (filterMode = "recent") => request("/external/deliveries/", { query: { filter_mode: filterMode } }).then(addStatusLabels),
    addDelivery: (delivery) => request("/external/add-delivery/", { method: "POST", body: delivery }),
    listCarriers: () => request("/external/supported_carriers.json", { authenticated: false }).then(normalizeCarrierNames),
  };
}

const responseFormat = z.enum(["markdown", "json"]).default("markdown");
const filterMode = z.enum(["active", "recent"]).default("recent");
const noInput = z.object({}).strict();

export function createParcelServer(options = {}) {
  const runtime = options.runtime || { keySource: null, sources_checked: [], lookup_errors: [], detected_agent: "remote", config_fallback_disabled: true };
  const getApiKey = options.getApiKey || (async () => options.apiKey);
  const hasCredentials = options.hasCredentials ?? hasText(options.apiKey);
  const writesEnabled = options.writesEnabled ?? false;
  // Called with (toolName, error, details) when a tool fails unexpectedly.
  // Only the stdio entry point passes one; the hosted Worker does not, and
  // tool arguments are never passed.
  const onToolError = options.onToolError || null;
  const api = options.api || createParcelApiClient({ getApiKey, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  const serverInfo = options.serverInfo || { name: "parcel-mcp-server", version: VERSION };
  const instructions = [
    "Call parcel_auth_status first when credential state is unknown.",
    "Use parcel_list_deliveries for recent or active tracking data and parcel_list_carriers before adding a delivery.",
    "Parcel returns cached tracking data and does not refresh a carrier on demand.",
    "The add endpoint accepts one delivery per request and has a 20-request daily limit, including failures.",
    writesEnabled ? "parcel_add_delivery is enabled." : "Write tools are hidden. Set PARCEL_ALLOW_WRITES=1 or grant write access in the hosted connector.",
  ].join(" ");
  const server = new McpServer(serverInfo, { instructions });
  const catalog = new Map();

  function register(name, config, handler, { write = false } = {}) {
    catalog.set(name, { write, config });
    if (write && !writesEnabled) return;
    server.registerTool(name, config, async (params) => {
      try { return await handler(params); } catch (error) {
        if (onToolError && shouldReportToolError(error)) {
          try { onToolError(name, error, { httpStatus: error instanceof ParcelApiError ? error.status : undefined }); } catch { /* Reporting must never change a tool's result. */ }
        }
        return errorResult(normalizeError(error));
      }
    });
  }

  register("parcel_auth_status", {
    title: "Parcel Authentication Status",
    description: "Inspect Parcel credential discovery and write-tool availability without calling Parcel.",
    inputSchema: noInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => textResult({
    authenticated: hasCredentials,
    credential_source: runtime.keySource?.source_label || runtime.tokenSource || (hasCredentials ? "injected credential" : null),
    writes_enabled: writesEnabled,
    advertised_tools: [...catalog.entries()].filter(([, item]) => !item.write || writesEnabled).map(([name]) => name),
    hidden_write_tools: [...catalog.entries()].filter(([, item]) => item.write && !writesEnabled).map(([name]) => name),
    detected_agent: runtime.detected_agent,
    config_fallback_disabled: runtime.config_fallback_disabled,
    sources_checked: runtime.sources_checked || [],
    lookup_errors: runtime.lookup_errors || [],
    setup: hasCredentials ? null : setupGuide(runtime.detected_agent),
  }));

  register("parcel_list_deliveries", {
    title: "List Parcel Deliveries",
    description: "Return Parcel's complete recent or active delivery list, including status, expected dates, and every cached carrier event. This covers GET /external/deliveries/.",
    inputSchema: z.object({ filter_mode: filterMode.describe("active returns upcoming deliveries; recent also includes recently completed deliveries"), response_format: responseFormat }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ filter_mode, response_format }) => {
    const data = await api.listDeliveries(filter_mode);
    if (response_format === "json") return textResult(data);
    const deliveries = data.deliveries || [];
    const lines = [`# Parcel deliveries (${filter_mode})`, "", `${deliveries.length} delivery${deliveries.length === 1 ? "" : "ies"}.`, ""];
    for (const item of deliveries) {
      lines.push(`## ${item.description || item.tracking_number}`, `- Tracking: ${item.tracking_number}`, `- Carrier: ${item.carrier_code}`, `- Status: ${item.status} (${item.status_code})`);
      if (item.date_expected) lines.push(`- Expected: ${item.date_expected}${item.date_expected_end ? ` to ${item.date_expected_end}` : ""}`);
      if (item.extra_information) lines.push(`- Extra information: ${item.extra_information}`);
      lines.push(`- Events: ${(item.events || []).length}`, "");
    }
    return textResult(data, lines.join("\n"));
  });

  register("parcel_get_delivery", {
    title: "Get Parcel Delivery",
    description: "Find one delivery by exact tracking number within Parcel's active or recent API response and return all of its cached events.",
    inputSchema: z.object({ tracking_number: z.string().min(1).max(200), filter_mode: filterMode, response_format: responseFormat }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ tracking_number, filter_mode, response_format }) => {
    const data = await api.listDeliveries(filter_mode);
    const delivery = (data.deliveries || []).find((item) => item.tracking_number === tracking_number);
    if (!delivery) throw new ParcelUserError(`Tracking number ${tracking_number} was not found in the ${filter_mode} delivery list.`);
    const output = { success: true, delivery };
    if (response_format === "json") return textResult(output);
    const lines = [`# ${delivery.description || delivery.tracking_number}`, `- Tracking: ${delivery.tracking_number}`, `- Carrier: ${delivery.carrier_code}`, `- Status: ${delivery.status} (${delivery.status_code})`];
    if (delivery.date_expected) lines.push(`- Expected: ${delivery.date_expected}${delivery.date_expected_end ? ` to ${delivery.date_expected_end}` : ""}`);
    lines.push("", "## Events");
    for (const event of delivery.events || []) lines.push(`- ${event.date}: ${event.event}${event.location ? ` — ${event.location}` : ""}${event.additional ? ` (${event.additional})` : ""}`);
    return textResult(output, lines.join("\n"));
  });

  register("parcel_list_carriers", {
    title: "List Parcel Carriers",
    description: "Return the complete, daily-updated map of Parcel carrier codes to names. This covers GET /external/supported_carriers.json and requires no API key.",
    inputSchema: z.object({ response_format: responseFormat }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ response_format }) => {
    const carriers = await api.listCarriers();
    const output = { success: true, count: Object.keys(carriers).length, carriers };
    return response_format === "json" ? textResult(output) : textResult(output, ["# Parcel carriers", "", ...Object.entries(carriers).map(([code, name]) => `- ${name}: \`${code}\``)].join("\n"));
  });

  register("parcel_find_carriers", {
    title: "Find Parcel Carriers",
    description: "Search the complete Parcel carrier catalog by code or display name before adding a delivery.",
    inputSchema: z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(100).default(20), response_format: responseFormat }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ query, limit, response_format }) => {
    const carriers = await api.listCarriers();
    const needle = query.toLocaleLowerCase();
    const matches = Object.entries(carriers).filter(([code, name]) => code.toLocaleLowerCase().includes(needle) || String(name).toLocaleLowerCase().includes(needle)).slice(0, limit).map(([code, name]) => ({ code, name }));
    const output = { success: true, query, count: matches.length, matches };
    return response_format === "json" ? textResult(output) : textResult(output, matches.length ? matches.map((item) => `- ${item.name}: \`${item.code}\``).join("\n") : `No Parcel carriers matched “${query}”.`);
  });

  register("parcel_add_delivery", {
    title: "Add Parcel Delivery",
    description: "Add exactly one delivery to Parcel. This covers every field accepted by POST /external/add-delivery/. The endpoint has a 20-request daily limit, including invalid requests.",
    inputSchema: z.object({
      tracking_number: z.string().min(1).max(200).describe("Carrier tracking number"),
      carrier_code: z.string().min(1).max(100).describe("Parcel carrier code; use parcel_find_carriers first, or pholder for a placeholder"),
      description: z.string().min(1).max(500).describe("Human-readable package contents"),
      language: z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toLowerCase()).default("en"),
      send_push_confirmation: z.boolean().default(false),
      postcode: z.string().min(1).max(100).optional(),
      email: z.string().email().max(320).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params) => textResult(await api.addDelivery(params)), { write: true });

  return { server, api, toolCatalog: catalog, instructions };
}

// Optional Sentry reporting for the stdio server; a no-op unless SENTRY_DSN
// is set, and never active in the Worker.
if (!IS_WORKER) await initErrorReporting({ release: `mcp-server-for-parcel@${VERSION}` });

const runtimeConfig = IS_WORKER ? null : resolveParcelRuntimeConfig();
const defaultInstance = createParcelServer({
  apiKey: runtimeConfig?.apiKey,
  hasCredentials: hasText(runtimeConfig?.apiKey),
  writesEnabled: runtimeConfig?.writesEnabled,
  runtime: runtimeConfig || undefined,
  onToolError: errorReportingEnabled() ? captureToolError : null,
});

export const server = defaultInstance.server;

function installProcessGuards() {
  process.on("uncaughtException", (error) => {
    console.error(redact(error?.stack || error));
    captureFatalError("uncaughtException", error);
  });
  process.on("unhandledRejection", (error) => {
    console.error(redact(error?.stack || error));
    captureFatalError("unhandledRejection", error);
  });
  // Signal handlers replace Node's default termination, so install them only
  // when there are queued Sentry events to flush.
  if (errorReportingEnabled()) {
    const exitAfterFlush = (code) => { flushErrorReporting(2000).finally(() => process.exit(code)); };
    process.once("SIGTERM", () => exitAfterFlush(143));
    process.once("SIGINT", () => exitAfterFlush(130));
  }
}

if (!IS_WORKER && process.env.PARCEL_MCP_NO_AUTOSTART !== "1") {
  installProcessGuards();
  if (!runtimeConfig.apiKey) console.error("PARCEL_API_KEY is not configured. Starting Parcel MCP in discovery-only mode; call parcel_auth_status.");
  await server.connect(new StdioServerTransport());
}
