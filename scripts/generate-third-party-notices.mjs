// Writes build/THIRD-PARTY-NOTICES.txt for the desktop package (L-08):
// the licence text of every production dependency. Forge copies it into the
// app resources (forge.config.ts: generateAssets + extraResource).
// Run: node scripts/generate-third-party-notices.mjs [outFile]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { productionPackageDirs } from "./dependency-graph.mjs";
import { readPackageNotice, renderNotices } from "./third-party-notices.mjs";

export function generateThirdPartyNotices(rootDir, outFile) {
  const entries = productionPackageDirs(rootDir).map((d) => readPackageNotice(d));
  const text = renderNotices({ productName: "Zrzur desktop", entries });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, text);
  return { count: entries.filter(Boolean).length, outFile };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(process.argv[2] ?? resolve(root, "build/THIRD-PARTY-NOTICES.txt"));
  const { count } = generateThirdPartyNotices(root, out);
  console.log(`THIRD-PARTY-NOTICES: ${count} packages -> ${out}`);
}
