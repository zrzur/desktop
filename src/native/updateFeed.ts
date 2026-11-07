/**
 * Resolve a Zrzur-owned static update feed URL.
 * Never falls back to GitHub / update.electronjs.org / Stoat / Zrzur hosts.
 *
 * Called from src/main.ts when deciding whether to start updateElectronApp.
 * Pure string in / string|null out — no secrets, no network I/O.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True only for zrzur.com or a real subdomain (a.b.zrzur.com), not suffix spoofs. */
export function isAuthorizedUpdateHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (LOOPBACK.has(host)) {
    return true;
  }
  if (host === "zrzur.com") {
    return true;
  }
  if (!host.endsWith(".zrzur.com")) {
    return false;
  }
  const label = host.slice(0, -".zrzur.com".length);
  // Reject empty, dotted-edge, or empty labels ("..", ".foo", "foo.")
  if (
    !label ||
    label.startsWith(".") ||
    label.endsWith(".") ||
    label.includes("..")
  ) {
    return false;
  }
  // ASCII DNS labels only for update hosts (blocks most IDN lookalikes here)
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(
      label,
    )
  ) {
    return false;
  }
  return true;
}

function updatesEnabledFlag(): string | undefined {
  return process.env.ZRZUR_ENABLE_UPDATES;
}

function updatesFeedEnv(): string | undefined {
  return process.env.ZRZUR_UPDATE_FEED_URL;
}

export function resolveUpdateFeedUrl(
  enableFlag: string | undefined = updatesEnabledFlag(),
  feedUrl: string | undefined = updatesFeedEnv(),
): string | null {
  if (enableFlag !== "1") {
    return null;
  }
  if (!feedUrl || !feedUrl.trim()) {
    console.warn(
      "ZRZUR_ENABLE_UPDATES=1 but ZRZUR_UPDATE_FEED_URL is unset; auto-update stays off.",
    );
    return null;
  }
  let url: URL;
  try {
    url = new URL(feedUrl.trim());
  } catch {
    console.warn(
      "ZRZUR_UPDATE_FEED_URL is not a valid URL; auto-update stays off.",
    );
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    console.warn(
      "ZRZUR_UPDATE_FEED_URL must be HTTPS without credentials; auto-update stays off.",
    );
    return null;
  }
  // Reject unexpected components that confuse static feed clients
  if (url.hash) {
    console.warn(
      "ZRZUR_UPDATE_FEED_URL must not include a URL fragment; auto-update stays off.",
    );
    return null;
  }
  if (!isAuthorizedUpdateHost(url.hostname)) {
    console.warn(
      "ZRZUR_UPDATE_FEED_URL host is not Zrzur-controlled; auto-update stays off.",
    );
    return null;
  }
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}
