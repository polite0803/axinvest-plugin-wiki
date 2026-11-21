#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = [];

function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "target" || entry.name === "dist" || entry.name === "node_modules") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.isFile() && entry.name === "Cargo.toml") manifests.push(full);
  }
}

visit(ROOT);
const violations = [];
for (const manifest of manifests) {
  const text = readFileSync(manifest, "utf8");
  for (const match of text.matchAll(/^\s*([a-zA-Z0-9_-]+)\s*=\s*\{([^}]*)\}\s*$/gm)) {
    const dependency = match[1];
    const body = match[2];
    const pathValue = /(?:^|,)\s*path\s*=\s*"([^"]+)"/.exec(body)?.[1];
    if (!pathValue) continue;
    const target = resolve(dirname(manifest), pathValue);
    const targetRelative = relative(ROOT, target);
    if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || resolve(target) === resolve(ROOT)) {
      violations.push(`${relative(ROOT, manifest)}: ${dependency} path 越出独立仓：${pathValue}`);
    }
  }
  if (/path\s*=\s*"[^"]*AxInvest[^"]*"/.test(text)) {
    violations.push(`${relative(ROOT, manifest)}: 仍指向主仓路径`);
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`PLUGIN_RELEASE_DEPENDENCIES_OK wiki: ${manifests.length} manifests`);
