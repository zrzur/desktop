/**
 * Which addresses start a service's sign-in, and which bring the person back
 * to Zrzur afterwards (see signIn.ts). No Electron here, so it is tested on
 * its own.
 */
/** Where each service's sign-in starts (host and path) */
const SIGN_IN_STARTS: readonly { host: string; path: string }[] = [
  { host: "steamcommunity.com", path: "/openid/login" },
  { host: "id.twitch.tv", path: "/oauth2/authorize" },
  { host: "github.com", path: "/login/oauth/authorize" },
  { host: "oauth.battle.net", path: "/authorize" },
];

/** Whether the main window is trying to open a service's sign-in page */
export function isSignInStart(address: string): boolean {
  try {
    const url = new URL(address);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      SIGN_IN_STARTS.some(
        (start) => start.host === url.hostname && url.pathname === start.path,
      )
    );
  } catch {
    return false;
  }
}

/**
 * The address to load in the main window when the sign-in window reaches
 * Zrzur again: only Zrzur's own /connections/<service>/return page, else
 * undefined
 */
export function signInReturn(
  address: string,
  appOrigin: string,
): string | undefined {
  try {
    const url = new URL(address);
    if (url.origin !== appOrigin) return undefined;
    return /^\/connections\/[a-z]+\/return\/?$/.test(url.pathname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
