/**
 * What the browser extension may report: one site (a domain, never an
 * address or a title), the name to show and the kind. Pure, so
 * `node --test` checks it.
 */

import type { DataActivity } from "./rpcProtocol";

const KINDS = ["Watching", "Listening", "Using", "Playing", "Streaming"] as const;

/** A plain domain: letters, digits, dots and dashes, no path, no port */
export function cleanDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const domain = value.trim().toLowerCase().replace(/^www\./, "");
  if (domain.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return undefined;
  if (domain.split(".").some((part) => !part || part.startsWith("-") || part.endsWith("-")))
    return undefined;
  return domain;
}

/** The activity for a site, or `null` to clear */
export function siteActivity(
  site: unknown,
  name: unknown,
  kind: unknown,
): DataActivity | null {
  const domain = cleanDomain(site);
  if (!domain) return null;
  const shown =
    typeof name === "string" && name.trim() ? name.trim().slice(0, 64) : domain;
  const type = KINDS.includes(kind as (typeof KINDS)[number])
    ? (kind as DataActivity["type"])
    : "Using";
  return { type, name: shown, started_at: new Date().toISOString() };
}
