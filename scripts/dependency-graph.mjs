// Production dependency graph of a package: `dependencies` and
// `optionalDependencies`, transitively, resolved from node_modules (pnpm
// symlinks included). devDependencies are never followed. Plain Node.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** @returns {string[]} real directories of every production dependency */
export function productionPackageDirs(rootDir) {
  const root = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const seen = new Set();
  const queue = [];
  const enqueue = (pkg, fromDir) => {
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    })) {
      const dir = findPackageDir(name, fromDir);
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        queue.push(dir);
      }
    }
  };
  enqueue(root, rootDir);
  while (queue.length) {
    const dir = queue.shift();
    enqueue(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")), dir);
  }
  return [...seen].sort();
}
