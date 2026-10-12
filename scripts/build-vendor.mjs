#!/usr/bin/env node
/**
 * Copies the published `@red-cup-engineering/pacing-intelligence-services-section`
 * math module verbatim from node_modules into public/vendor/, so the
 * browser bundle imports byte-identical code to the one the paid gateway
 * runs -- never a hand-transcribed copy. Run before `wrangler dev` or
 * `wrangler deploy` (wired as the package.json `build`/`pretest` script).
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(appRoot, "public", "vendor");

const sourcePath = require.resolve("@red-cup-engineering/pacing-intelligence-services-section");
const packageJsonPath = join(dirname(sourcePath), "..", "package.json");
const { version } = JSON.parse(await readFile(packageJsonPath, "utf8"));

await mkdir(vendorDir, { recursive: true });
await copyFile(sourcePath, join(vendorDir, "pacing-intelligence.mjs"));

console.log(`vendored @red-cup-engineering/pacing-intelligence-services-section@${version} -> public/vendor/pacing-intelligence.mjs`);
