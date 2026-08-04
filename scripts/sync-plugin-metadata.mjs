#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = read("package.json");
const pluginName = "parcel-mcp-server";
for (const file of [".claude-plugin/plugin.json", "codex/.codex-plugin/plugin.json", ".hermes-plugin/plugin.json", ".antigravity-plugin/plugin.json"]) update(file, (json) => { json.version = pkg.version; });
for (const file of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", ".hermes-plugin/marketplace.json", ".antigravity-plugin/marketplace.json"]) update(file, (json) => { for (const plugin of json.plugins || []) if (plugin.name === pluginName) plugin.version = pkg.version; });
for (const file of [".mcp.json", "codex/.codex-plugin/mcp.json", ".hermes-plugin/mcp.json", ".antigravity-plugin/mcp_config.json"]) update(file, (json) => {
  const server = json.mcpServers?.[pluginName] || json[pluginName];
  const index = server?.args?.findIndex((arg) => typeof arg === "string" && arg.startsWith("@oliverames/"));
  if (index >= 0) server.args[index] = `${pkg.name}@latest`;
});
const indexPath = path.join(root, "index.js");
fs.writeFileSync(indexPath, fs.readFileSync(indexPath, "utf8").replace(/export const VERSION = "[^"]+";/, `export const VERSION = "${pkg.version}";`));
console.log(`Synced plugin metadata to ${pkg.version}.`);

function read(file) { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); }
function update(file, mutate) { const json = read(file); mutate(json); fs.writeFileSync(path.join(root, file), `${JSON.stringify(json, null, 2)}\n`); }
