#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "parcel-mcp-packed-"));
const budget = 15_000;

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

async function probe(bin) {
  const child = spawn(process.execPath, [path.join("node_modules", ".bin", bin)], { cwd: work, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PARCEL_API_KEY: "packed-smoke-key", PARCEL_ALLOW_WRITES: "1", PARCEL_DISABLE_AGENT_CONFIG_FALLBACK: "1", PARCEL_MCP_NO_AUTOSTART: "" } });
  let buffer = "";
  let stderr = "";
  const pending = new Map();
  child.stderr.on("data", (chunk) => { stderr += chunk; });
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
    setTimeout(() => reject(new Error(`${bin}: ${method} timed out; stderr: ${stderr || "(empty)"}`)), budget);
  });
  try {
    await send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "packed-smoke", version: "1" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = (await send(2, "tools/list")).result.tools;
    if (!tools.length) throw new Error(`${bin} advertised no tools`);
  } finally { child.stdin.end(); child.kill(); }
}

let failed = false;
try {
  const packed = run("npm", ["pack", "--silent", "--pack-destination", work], { cwd: root }).trim().split("\n").pop();
  fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "packed-smoke", private: true }));
  run("npm", ["install", "--silent", "--no-audit", "--no-fund", path.join(work, packed)], { cwd: work });
  for (const bin of ["mcp-server-for-parcel", "parcel-mcp-server"]) await probe(bin);
  console.log("Both packed bin names complete an MCP handshake.");
} catch (error) { console.error(error.message); failed = true; }
finally { fs.rmSync(work, { recursive: true, force: true }); }
process.exit(failed ? 1 : 0);
