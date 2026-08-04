#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, "index.js");
const budget = 10_000;

async function probe(allowWrites) {
  const child = spawn(process.execPath, [entry], { cwd: root, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, PARCEL_API_KEY: "smoke-key", PARCEL_ALLOW_WRITES: allowWrites ? "1" : "", PARCEL_DISABLE_AGENT_CONFIG_FALLBACK: "1" } });
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
    setTimeout(() => reject(new Error(`${method} timed out`)), budget);
  });
  const started = Date.now();
  const init = await send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parcel-smoke", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = (await send(2, "tools/list")).result.tools;
  child.stdin.end();
  child.kill();
  return { init: init.result, tools, startupMs: Date.now() - started };
}

const readOnly = await probe(false);
const readWrite = await probe(true);
const problems = [];
if (!readOnly.init.instructions) problems.push("initialize response has no instructions");
if (readOnly.startupMs > budget) problems.push(`startup took ${readOnly.startupMs}ms`);
if (readOnly.tools.some((tool) => tool.name === "parcel_add_delivery")) problems.push("write tool is visible without PARCEL_ALLOW_WRITES");
if (!readWrite.tools.some((tool) => tool.name === "parcel_add_delivery")) problems.push("write tool is missing with PARCEL_ALLOW_WRITES=1");
for (const tool of readWrite.tools) {
  if (!tool.name.startsWith("parcel_")) problems.push(`${tool.name} lacks parcel_ prefix`);
  if (!tool.description) problems.push(`${tool.name} lacks a description`);
  if (!tool.title) problems.push(`${tool.name} lacks a display title`);
}
if (problems.length) {
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`${readOnly.init.serverInfo.name} v${readOnly.init.serverInfo.version}: ${readOnly.tools.length} read-only tools, ${readWrite.tools.length} with writes; startup ${readOnly.startupMs}ms.`);
