#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = read("package.json");
const pluginName = "parcel-mcp-server";
const problems = [];
for (const file of [".claude-plugin/plugin.json", "codex/.codex-plugin/plugin.json", ".hermes-plugin/plugin.json", ".antigravity-plugin/plugin.json"]) if (read(file).version !== pkg.version) problems.push(`${file}: version mismatch`);
for (const file of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", ".hermes-plugin/marketplace.json", ".antigravity-plugin/marketplace.json"]) {
  const plugin = (read(file).plugins || []).find((item) => item.name === pluginName);
  if (!plugin || plugin.version !== pkg.version) problems.push(`${file}: plugin version mismatch`);
}
for (const file of [".mcp.json", "codex/.codex-plugin/mcp.json", ".hermes-plugin/mcp.json", ".antigravity-plugin/mcp_config.json"]) {
  const json = read(file); const server = json.mcpServers?.[pluginName] || json[pluginName];
  if (!server?.args?.includes(`${pkg.name}@latest`)) problems.push(`${file}: package target mismatch`);
}
const version = fs.readFileSync(path.join(root, "index.js"), "utf8").match(/export const VERSION = "([^"]+)";/)?.[1];
if (version !== pkg.version) problems.push("index.js: handshake version mismatch");
for (const entry of pkg.files || []) if (!fs.existsSync(path.join(root, entry.replace(/\/$/, "")))) problems.push(`package file missing: ${entry}`);
if (problems.length) { problems.forEach((problem) => console.error(`- ${problem}`)); process.exit(1); }
console.log(`Release consistency OK for ${pkg.name}@${pkg.version}.`);
if (process.argv.includes("--registry")) {
  const response = await fetch(`https://registry.npmjs.org/${pkg.name.replace("/", "%2F")}`);
  if (response.ok && (await response.json()).versions?.[pkg.version]) { console.error(`${pkg.name}@${pkg.version} is already published.`); process.exit(1); }
}
function read(file) { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); }
