/**
 * Reading a Squirrel update feed: the RELEASES file lists every package as
 * `<sha1> <file name> <size>`. This module decides, from that text alone,
 * whether there is a newer full package than the running version.
 *
 * Pure: no network, no Electron. The download is updateDownload.ts.
 */

export interface UpdatePackage {
  /** Version as written in the file name, e.g. "26.2.0" or "26.1.0-beta3" */
  version: string;
  /** File name inside the feed folder; letters, digits, dot, dash, underscore only */
  fileName: string;
  /** Lower-case hex SHA-1 from the feed */
  sha1: string;
  /** Size in bytes from the feed */
  size: number;
}

type Parsed = { numbers: [number, number, number]; pre: (string | number)[] };

/** "26.1.0-beta.2" and "26.1.0-beta2" (Squirrel's spelling) are the same version */
function parseVersion(version: string): Parsed | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(
    version.trim(),
  );
  if (!match) return null;
  const pre = match[4]
    ? (match[4].match(/[A-Za-z]+|\d+/g) ?? []).map((part) =>
        /^\d+$/.test(part) ? Number(part) : part.toLowerCase(),
      )
    : [];
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre,
  };
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when equal.
 * A version that cannot be read is older than every readable one.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i])
      return left.numbers[i] - right.numbers[i];
  }
  // a release is newer than its own pre-releases
  if (!left.pre.length || !right.pre.length)
    return (left.pre.length ? 0 : 1) - (right.pre.length ? 0 : 1);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    // numbers sort before words (semver)
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const SAFE_FILE = /^[A-Za-z0-9._-]{1,128}$/;

/** Every well-formed full package in a RELEASES text; anything else is skipped */
export function parseReleases(
  text: string,
  packageId: string,
): UpdatePackage[] {
  const packages: UpdatePackage[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const [sha1, name, size] = parts;
    if (!/^[0-9a-fA-F]{40}$/.test(sha1) || !/^\d{1,12}$/.test(size)) continue;
    // a feed may write a path or URL before the name; only the name is used,
    // so a feed can never point the download at another folder or host
    const fileName = name.split(/[\\/]/).pop() ?? "";
    if (!SAFE_FILE.test(fileName) || fileName.includes("..")) continue;
    const prefix = `${packageId}-`;
    const suffix = "-full.nupkg";
    if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) continue;
    const version = fileName.slice(prefix.length, -suffix.length);
    if (!parseVersion(version)) continue;
    const bytes = Number(size);
    if (bytes <= 0) continue;
    packages.push({ version, fileName, sha1: sha1.toLowerCase(), size: bytes });
  }
  return packages;
}

/** The newest full package that is newer than the running version, if any */
export function pickUpdate(
  releasesText: string,
  currentVersion: string,
  packageId: string,
): UpdatePackage | null {
  let best: UpdatePackage | null = null;
  for (const candidate of parseReleases(releasesText, packageId)) {
    if (compareVersions(candidate.version, currentVersion) <= 0) continue;
    if (!best || compareVersions(candidate.version, best.version) > 0)
      best = candidate;
  }
  return best;
}

/** The one line Squirrel needs to install a package from a local folder */
export function releasesLine(update: UpdatePackage): string {
  return `${update.sha1.toUpperCase()} ${update.fileName} ${update.size}`;
}
