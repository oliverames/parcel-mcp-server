import assert from "node:assert/strict";
import test from "node:test";

process.env.PARCEL_MCP_NO_AUTOSTART = "1";
process.env.PARCEL_DISABLE_AGENT_CONFIG_FALLBACK = "1";

const { createParcelApiClient, createParcelServer, STATUS_LABELS, VERSION } = await import("../index.js");

test("exports stable metadata and every documented status", () => {
  assert.equal(VERSION, "1.0.0");
  assert.deepEqual(Object.keys(STATUS_LABELS).map(Number), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("listDeliveries covers the documented endpoint and decorates statuses", async () => {
  const calls = [];
  const client = createParcelApiClient({ getApiKey: async () => "secret", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ success: true, deliveries: [{ tracking_number: "X", carrier_code: "ups", description: "Camera", status_code: 4, events: [] }] }), { status: 200 });
  } });
  const data = await client.listDeliveries("active");
  assert.equal(data.deliveries[0].status, "out_for_delivery");
  assert.equal(calls[0].url, "https://api.parcel.app/external/deliveries/?filter_mode=active");
  assert.equal(calls[0].options.headers["api-key"], "secret");
  assert.equal(calls[0].options.redirect, "manual");
});

test("addDelivery sends every documented request field", async () => {
  let received;
  const client = createParcelApiClient({ getApiKey: async () => "secret", fetchImpl: async (url, options) => {
    received = { url: String(url), options };
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } });
  const request = { tracking_number: "1Z", carrier_code: "ups", description: "Lens", language: "en", send_push_confirmation: true, postcode: "05602", email: "oliver@example.com" };
  await client.addDelivery(request);
  assert.equal(received.url, "https://api.parcel.app/external/add-delivery/");
  assert.equal(received.options.method, "POST");
  assert.deepEqual(JSON.parse(received.options.body), request);
});

test("carrier catalog is unauthenticated", async () => {
  let headers;
  const client = createParcelApiClient({ fetchImpl: async (_url, options) => { headers = options.headers; return new Response(JSON.stringify({ fedex: "FedEx" }), { status: 200 }); } });
  assert.deepEqual(await client.listCarriers(), { fedex: "FedEx" });
  assert.equal(headers["api-key"], undefined);
});

test("API failures use Parcel's error message and never expose the key", async () => {
  const client = createParcelApiClient({ getApiKey: async () => "live-secret", fetchImpl: async () => new Response(JSON.stringify({ success: false, error_message: "Invalid tracking number" }), { status: 400 }) });
  await assert.rejects(() => client.addDelivery({}), /Invalid tracking number/);
});

test("write tool is absent until explicitly enabled", () => {
  const readOnly = createParcelServer({ apiKey: "x", hasCredentials: true, writesEnabled: false });
  const readWrite = createParcelServer({ apiKey: "x", hasCredentials: true, writesEnabled: true });
  assert.equal(readOnly.toolCatalog.get("parcel_add_delivery").write, true);
  assert.equal(readWrite.toolCatalog.get("parcel_add_delivery").write, true);
  assert.match(readOnly.instructions, /Write tools are hidden/);
  assert.match(readWrite.instructions, /parcel_add_delivery is enabled/);
});

test("refuses redirects before credentials can cross hosts", async () => {
  const client = createParcelApiClient({ getApiKey: async () => "secret", fetchImpl: async () => new Response("", { status: 302, headers: { Location: "https://evil.example/" } }) });
  await assert.rejects(() => client.listDeliveries(), /Refusing Parcel API redirect/);
});
