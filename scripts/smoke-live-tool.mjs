#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [path.join(root, "index.js")], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, PARCEL_DISABLE_AGENT_CONFIG_FALLBACK: "1" },
});
let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});
const send = (id, method, params = {}) => new Promise((resolve, reject) => {
  pending.set(id, resolve);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
});

try {
  await send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parcel-live-tool-smoke", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const response = await send(2, "tools/call", { name: "parcel_find_carriers", arguments: { query: "FedEx", limit: 5, response_format: "json" } });
  if (response.error) throw new Error(JSON.stringify(response.error));
  const structured = response.result.structuredContent;
  if (!structured?.matches?.some((carrier) => carrier.code === "fedex")) throw new Error("Live tool call did not return the FedEx carrier code.");
  console.log(`Live MCP tool call passed with ${structured.count} carrier match(es).`);
} finally {
  child.stdin.end();
  child.kill();
}
