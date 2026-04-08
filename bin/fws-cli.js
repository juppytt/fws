#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
const script = path.join(__dirname, "fws.ts");
try {
  execFileSync(tsx, [script, ...process.argv.slice(2)], { stdio: "inherit" });
} catch (e) {
  process.exit(e.status || 1);
}
