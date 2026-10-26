// Sentry reporting must never carry delivery data. These tests run the real
// @sentry/node client against a loopback DSN and inspect the raw envelopes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.PARCEL_MCP_NO_AUTOSTART = "1";
process.env.PARCEL_DISABLE_AGENT_CONFIG_FALLBACK = "1";
delete process.env.SENTRY_DSN;
delete process.env.PARCEL_API_KEY;
delete process.env.PARCEL_API_KEY_FILE;
delete process.env.PARCEL_OP_PATH;

const reporting = await import("../lib/error-reporting.mjs");
const { createParcelServer, VERSION } = await import("../index.js");

// @sentry/node 11 supports Node 20.19+; older runtimes simply run without reporting.
const [major, minor] = process.versions.node.split(".").map(Number);
const sentrySupported = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
const skip = sentrySupported ? false : "@sentry/node 11 needs Node 20.19 or newer";

// Synthetic delivery strings that must never appear in an envelope.
const TRACKING = "1ZSENTINEL4417";
const DESCRIPTION = "Synthetic Gift Sentinel";
const ADDRESS = "12 Sentinel Lane, Montpelier VT 05602";

const envelopes = [];
const sink = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = Buffer.concat(chunks);
    if (request.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    envelopes.push(body.toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
});
await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
test.after(() => new Promise((resolve) => sink.close(resolve)));

const enabled = sentrySupported && await reporting.initErrorReporting({
  env: { SENTRY_DSN: `http://publickey@127.0.0.1:${sink.address().port}/1` },
  release: `mcp-server-for-parcel@${VERSION}`,
});

function eventsFrom(raw) {
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.exception);
}

async function callTool(fetchImpl, name, args) {
  const { server } = createParcelServer({ apiKey: "fake-key-a", hasCredentials: true, fetchImpl, onToolError: reporting.captureToolError });
  const client = new Client({ name: "sentry-scrub-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

test("scrubEvent drops request, user, extra, breadcrumbs, and unsafe tags and contexts", () => {
  const event = reporting.scrubEvent({
    message: `Delivery ${TRACKING}`,
    request: { data: { description: DESCRIPTION } },
    user: { ip_address: "203.0.113.9", email: "someone@example.com" },
    extra: { args: { tracking_number: TRACKING } },
    breadcrumbs: [{ message: ADDRESS }],
    server_name: "someones-laptop",
    tags: { tool: "parcel_get_delivery", tracking: TRACKING, source: `x ${ADDRESS}` },
    contexts: { runtime: { name: "node" }, app: { address: ADDRESS } },
    exception: { values: [{ type: "TypeError", value: `bad ${TRACKING}`, mechanism: { type: "generic", data: { address: ADDRESS } }, stacktrace: { frames: [{ filename: "/Users/someone/project/index.js", vars: { tracking: TRACKING }, context_line: DESCRIPTION }] } }] },
  });
  const text = JSON.stringify(event);
  for (const secret of [TRACKING, DESCRIPTION, ADDRESS, "203.0.113.9", "someone@example.com", "someones-laptop"]) {
    assert.equal(text.includes(secret), false, `event still contains ${secret}`);
  }
  assert.deepEqual(event.tags, { tool: "parcel_get_delivery" });
  assert.deepEqual(Object.keys(event.contexts), ["runtime"]);
  assert.equal(event.exception.values[0].value, reporting.SCRUBBED_MESSAGE);
});

test("frame-shaped lines inside an error message never become stack frames", () => {
  const original = new Error(`lookup failed\n    at /Users/x/secret.js:1:1\n    at ${DESCRIPTION} (${ADDRESS}:2:3)`);
  const safe = reporting.sanitizeError(original);
  for (const secret of ["/Users/x/secret.js", "secret.js", DESCRIPTION, ADDRESS]) {
    assert.equal(safe.stack.includes(secret), false, `stack still contains ${secret}`);
  }
  assert.match(safe.stack, /\n\s+at /);

  const event = reporting.scrubEvent({ exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [
    { filename: "/Users/x/secret.js", function: "?", lineno: 1 },
    { filename: "app:///index.js", function: `${DESCRIPTION} memo`, lineno: 2 },
    { filename: "node:internal/process/task_queues", function: "process.processTicksAndRejections", lineno: 3 },
    { filename: "app:///index.js", function: "request", lineno: 4 },
  ] } }] } });
  assert.deepEqual(event.exception.values[0].stacktrace.frames.map((frame) => frame.function), ["process.processTicksAndRejections", "request"]);
});

test("frame paths are package-relative or reduced to a basename on every platform", () => {
  assert.equal(reporting.relativeFramePath("C:\\Users\\someone\\AppData\\npm-cache\\_npx\\abc\\node_modules\\zod\\index.js"), "app:///node_modules/zod/index.js");
  assert.equal(reporting.relativeFramePath("C:\\Users\\someone\\Documents\\gift list.js"), "gift list.js");
  assert.equal(reporting.relativeFramePath("\\\\fileserver\\share\\someone\\tool.js"), "tool.js");
  assert.equal(reporting.relativeFramePath("file:///C:/Users/someone/elsewhere/x.mjs"), "x.mjs");
  assert.equal(reporting.relativeFramePath("/home/someone/other-project/y.js"), "y.js");
  assert.equal(reporting.relativeFramePath(new URL("../index.js", import.meta.url).pathname), "app:///index.js");
});

test("an unexpected tool failure reaches Sentry with its tool name and no delivery data", { skip }, async () => {
  assert.equal(enabled, true, "initErrorReporting did not enable Sentry");
  envelopes.length = 0;
  // A network failure whose message echoes the tracking number and address.
  const result = await callTool(async () => { throw new TypeError(`fetch failed for ${TRACKING} at ${ADDRESS}`); }, "parcel_get_delivery", { tracking_number: TRACKING });
  assert.equal(result.isError, true);
  assert.equal(await reporting.flushErrorReporting(5000), true);

  const raw = envelopes.join("\n");
  const events = eventsFrom(raw);
  assert.equal(events.length, 1, raw);
  const [event] = events;
  for (const secret of [TRACKING, "SENTINEL", "Sentinel", "fake-key-a", "api.parcel.app", homedir()]) {
    assert.equal(raw.includes(secret), false, `envelope contains ${secret}`);
  }
  assert.equal(event.tags.tool, "parcel_get_delivery");
  assert.equal(event.tags.source, "tool_handler");
  assert.equal(event.exception.values[0].type, "TypeError");
  assert.equal(event.exception.values[0].value, reporting.SCRUBBED_MESSAGE);
  const frames = event.exception.values[0].stacktrace?.frames ?? [];
  assert.ok(frames.length > 0, "event kept no stack frames");
  assert.ok(frames.every((frame) => /^(app:\/\/\/|node:)/.test(frame.filename)), JSON.stringify(frames));
  assert.equal(event.user, undefined);
  assert.equal(event.request, undefined);
  assert.equal(event.server_name, undefined);
  assert.equal(event.release, `mcp-server-for-parcel@${VERSION}`);
});

test("expected failures are not reported; Parcel 5xx answers are, with their status", { skip }, async () => {
  envelopes.length = 0;
  const deliveries = JSON.stringify({ success: true, deliveries: [] });
  // Unknown tracking number, Parcel's own rejection, a 4xx, then a 5xx.
  assert.equal((await callTool(async () => new Response(deliveries, { status: 200 }), "parcel_get_delivery", { tracking_number: TRACKING })).isError, true);
  assert.equal((await callTool(async () => new Response(JSON.stringify({ success: false, error_message: `Invalid ${TRACKING}` }), { status: 200 }), "parcel_list_deliveries", {})).isError, true);
  assert.equal((await callTool(async () => new Response(JSON.stringify({ success: false, error_message: `Bad key ${TRACKING}` }), { status: 401 }), "parcel_list_deliveries", {})).isError, true);
  assert.equal((await callTool(async () => new Response(JSON.stringify({ success: false, error_message: `Down ${ADDRESS}` }), { status: 503 }), "parcel_list_deliveries", {})).isError, true);
  assert.equal(await reporting.flushErrorReporting(5000), true);

  const raw = envelopes.join("\n");
  const events = eventsFrom(raw);
  assert.equal(events.length, 1, raw);
  assert.equal(events[0].tags.tool, "parcel_list_deliveries");
  assert.equal(events[0].tags.source, "parcel_api");
  assert.equal(events[0].tags.http_status, "503");
  assert.equal(events[0].exception.values[0].type, "ParcelApiError");
  assert.equal(raw.includes(ADDRESS), false);
  assert.equal(raw.includes(TRACKING), false);
});
