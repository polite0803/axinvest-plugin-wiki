#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

// 版本一致性：源只有三处 —— .axinvest-plugin-repos.json 的 pluginVersion/rustVersion、
// plugin-ci.yml 的 env.PLUGIN_VERSION、各 Cargo.toml 的 [package] version。
// 任何一处漂移都必须在这里先红，别等打包产物才发现。
const NL = String.fromCharCode(10);
const releaseFile = join(ROOT, ".axinvest-plugin-repos.json");
const ciFile = join(ROOT, ".github", "workflows", "plugin-ci.yml");
if (existsSync(releaseFile)) {
  const meta = JSON.parse(readFileSync(releaseFile, "utf8"));
  const declared = [];
  if (typeof meta.pluginVersion === "string") {
    declared.push([".axinvest-plugin-repos.json pluginVersion", meta.pluginVersion]);
  }
  if (typeof meta.rustVersion === "string") {
    declared.push([".axinvest-plugin-repos.json rustVersion", meta.rustVersion]);
  }
  const ciLines = existsSync(ciFile) ? readFileSync(ciFile, "utf8").split(NL) : [];
  const ciLine = ciLines.find((line) => line.trim().startsWith("PLUGIN_VERSION:"));
  declared.push([
    "plugin-ci.yml env.PLUGIN_VERSION",
    ciLine
      ? ciLine.slice(ciLine.indexOf(":") + 1).trim().split('"').join("").split("'").join("")
      : "<missing>",
  ]);
  for (const manifest of manifests) {
    const lines = readFileSync(manifest, "utf8").split(NL);
    const start = lines.findIndex((line) => line.trim() === "[package]");
    if (start < 0) continue;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith("[")) break;
      if (line.startsWith("version")) {
        const value = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
        if (value) declared.push([relative(ROOT, manifest), value]);
        break;
      }
    }
  }
  const expected = meta.pluginVersion;
  const drift = declared.filter((entry) => entry[1] !== expected);
  if (drift.length) {
    violations.push(
      "版本不一致（应全部为 " + expected + "）：" + NL
        + declared.map((entry) => "  " + entry[0] + " = " + entry[1]).join(NL),
    );
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`PLUGIN_RELEASE_DEPENDENCIES_OK wiki: ${manifests.length} manifests`);
