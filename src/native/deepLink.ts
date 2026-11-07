/**
 * zrzur:// links: a public Zrzur site (discover.zrzur.com, designs.zrzur.com)
 * opens the desktop app on the server or design the person chose, e.g.
 * zrzur://discover/rabea?join=1 → /discover/rabea?join=1 in the app.
 *
 * Only these app sections can be opened; anything else is ignored, so a
 * link can never point the window at another site.
 */
export const LINK_PROTOCOL = "zrzur";

/** Zrzur Beta registers its own scheme, so it never takes the stable app's links */
export const BETA_LINK_PROTOCOL = "zrzur-beta";

/**
 * The scheme this build handles: `zrzur-beta` when its application is the
 * beta site (beta.zrzur.com), `zrzur` otherwise
 */
export function linkProtocolFor(applicationUrl: string): string {
  try {
    return new URL(applicationUrl).hostname.startsWith("beta.")
      ? BETA_LINK_PROTOCOL
      : LINK_PROTOCOL;
  } catch {
    return LINK_PROTOCOL;
  }
}

const SECTIONS = new Set([
  "discover",
  "designs",
  "invite",
  "server",
  "channel",
  "bot",
]);

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_QUERY = new Set(["join", "use", "hl"]);

/** The app path a zrzur:// link stands for, or undefined if it is not one */
export function appPathFromLink(
  link: string,
  protocol: string = LINK_PROTOCOL,
): string | undefined {
  // "..", "%2F" and the like never belong in one of these links
  if (/\.\.|%/.test(link)) return undefined;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${protocol}:` || url.username || url.password)
    return undefined;

  // zrzur://discover/rabea → host "discover", path "/rabea"
  const segments = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  if (!segments.length || !SECTIONS.has(segments[0]) || segments.length > 4)
    return undefined;
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment)))
    return undefined;

  const query = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (SAFE_QUERY.has(key) && SAFE_SEGMENT.test(value)) query.set(key, value);
  }
  const search = query.toString();
  return `/${segments.join("/")}${search ? `?${search}` : ""}`;
}

/** The first zrzur:// link among command-line arguments (Windows, Linux) */
export function linkFromArgs(
  args: string[],
  protocol: string = LINK_PROTOCOL,
): string | undefined {
  return args.find((arg) => arg.startsWith(`${protocol}://`));
}
