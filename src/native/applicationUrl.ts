/** Resolve the configured application origin without an upstream fallback. */
export function resolveApplicationUrl(options: {
  packaged: boolean;
  commandLine?: string;
  environment?: string;
  bundled?: string;
}): string {
  const configured =
    options.commandLine || options.environment || options.bundled;
  if (!configured && options.packaged) {
    throw new Error(
      "This Zarzour installer has no application URL. Install a configured release.",
    );
  }
  const url = new URL(configured || "http://127.0.0.1:5173");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Zarzour requires an HTTP(S) application URL without credentials.",
    );
  }
  const upstream = [
    "stoat.chat",
    "stoatusercontent.com",
    "revolt.chat",
    "revoltusercontent.com",
  ];
  const hostname = url.hostname.replace(/\.$/, "");
  if (
    upstream.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    )
  ) {
    throw new Error(
      "Upstream application servers are not a Zarzour deployment.",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (
    options.packaged &&
    url.protocol !== "https:" &&
    !(loopback && options.commandLine)
  ) {
    throw new Error(
      "Packaged Zarzour requires HTTPS; loopback is allowed only through an explicit development override.",
    );
  }
  return url.href;
}
