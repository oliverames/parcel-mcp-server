#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
const stage = path.join(dist, "mcpb-stage");
const output = path.join(dist, `parcel-mcp-server-${pkg.version}.mcpb`);
const manifest = {
  manifest_version: "0.2", name: "parcel-mcp-server", display_name: "Parcel", version: pkg.version, description: pkg.description,
  long_description: "Read recent and active Parcel deliveries, inspect complete tracking histories, discover carrier codes, and add deliveries with every field supported by Parcel's public API.",
  author: { name: "Oliver Ames", email: "oliverames@gmail.com", url: "https://github.com/oliverames" }, homepage: pkg.homepage, documentation: pkg.homepage, support: pkg.bugs.url, icon: "icon.png", license: "MIT", keywords: pkg.keywords,
  server: { type: "node", entry_point: "index.js", mcp_config: { command: "node", args: ["${__dirname}/index.js"], env: { PARCEL_API_KEY: "${user_config.api_key}", PARCEL_ALLOW_WRITES: "${user_config.allow_writes}", PARCEL_DISABLE_AGENT_CONFIG_FALLBACK: "1" } } },
  user_config: {
    api_key: { type: "string", title: "Parcel API key", description: "Generate at https://web.parcelapp.net/", sensitive: true, required: true },
    allow_writes: { type: "string", title: "Enable add-delivery tool", description: "Set to 1 to advertise parcel_add_delivery.", required: false, default: "" },
  },
  compatibility: { claude_desktop: ">=0.10.0", platforms: ["darwin", "win32", "linux"], runtimes: { node: ">=18.0.0" } },
};
fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of ["index.js", "package.json", "package-lock.json", "LICENSE", "README.md"]) fs.copyFileSync(path.join(root, file), path.join(stage, file));
fs.copyFileSync(path.join(root, "assets/icon.png"), path.join(stage, "icon.png"));
execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit" });
fs.rmSync(output, { force: true }); execFileSync("zip", ["-qr", output, "."], { cwd: stage }); fs.rmSync(stage, { recursive: true, force: true });
console.log(`Built ${path.relative(root, output)}.`);
