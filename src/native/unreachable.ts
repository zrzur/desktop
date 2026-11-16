/**
 * When the Zrzur address cannot be loaded (no network, the site is down, a
 * gateway error), the app window never shows a browser error or a blank
 * page. It shows this page, in the person's language, keeps trying by
 * itself, and opens the app the moment the address answers.
 *
 * The page is one self-contained document, like the start-up window's.
 */
import { type BrowserWindow, ipcMain, net } from "electron";

import arabicFont from "../../assets/startup/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2?inline";
import arabicFontMedium from "../../assets/startup/fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2?inline";
import cyrillicFont from "../../assets/startup/fonts/ibm-plex-sans-cyrillic-wght-normal.woff2?inline";
import sansFont from "../../assets/startup/fonts/ibm-plex-sans-latin-wght-normal.woff2?inline";
import logoStill from "../../assets/startup/logo.svg?raw";

import { shellLanguage } from "./locale";
import { nextRetryDelay } from "./retryDelay";
import { type ShellLocale, shellString } from "./startup/startupStrings";

const PAGE_PREFIX = "data:text/html;charset=utf-8,";

function page(locale: ShellLocale, online: boolean, controls: boolean) {
  const t = (key: Parameters<typeof shellString>[1]) =>
    shellString(locale, key);
  const esc = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const rtl = locale === "ar";
  const face = (family: string, weight: string, url: string) =>
    `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url("${url}") format("woff2")}`;
  const fonts = [
    ...(locale === "ru"
      ? [face("IBM Plex Sans", "100 700", cyrillicFont)]
      : []),
    ...(rtl
      ? [
          face("IBM Plex Sans Arabic", "400", arabicFont),
          face("IBM Plex Sans Arabic", "500", arabicFontMedium),
        ]
      : []),
  ];
  // Latin is always there; Cyrillic is a second family beside it (the same
  // family name twice would hide one file). IBM Plex has no Chinese: the
  // system's own Simplified Chinese face follows.
  const latin = face("Plex Latin", "100 700", sansFont);
  const family = rtl
    ? `"IBM Plex Sans Arabic","Plex Latin"`
    : `"Plex Latin","IBM Plex Sans","Microsoft YaHei UI","PingFang SC","Noto Sans CJK SC"`;
  return `<!doctype html>
<html lang="${locale}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">
<title>${esc(t("name"))}</title>
<style>${latin}${fonts.join("")}
*{box-sizing:border-box;margin:0}
html,body{height:100%;background:#0D0E16;overflow:hidden}
body{color:#F0F1F8;font-family:${family},system-ui,sans-serif;display:flex;flex-direction:column;user-select:none;cursor:default}
.bar{height:40px;flex:none;display:flex;justify-content:flex-end;align-items:center;gap:4px;padding:0 8px;-webkit-app-region:drag}
.bar button{width:32px;height:28px;border:0;border-radius:6px;background:none;color:#A1A5B8;display:grid;place-items:center;cursor:pointer;-webkit-app-region:no-drag}
.bar button:hover{background:#242638;color:#F0F1F8}
.box{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 64px;text-align:center}
.mark svg{display:block;width:112px;height:112px}
h1{font-size:18px;line-height:${rtl ? 28 : 26}px;font-weight:500;margin-top:8px;text-wrap:balance}
.dot{display:inline-block;width:8px;height:8px;border-radius:999px;background:#F3B96B;margin-inline-end:8px;vertical-align:2px}
p{font-size:13px;line-height:${rtl ? 22 : 20}px;color:#A1A5B8;margin-top:4px;max-width:360px;text-wrap:balance}
.btn{margin-top:20px;height:36px;padding:0 20px;border-radius:10px;border:1px solid transparent;background:#E0195F;color:#fff;font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.btn:hover{background:#C8155A}.btn:active{background:#B0124F}
.btn[disabled]{background:#242638;color:#8C90A6;cursor:default}
:focus-visible{outline:2px solid #E0195F;outline-offset:2px}
</style>
</head>
<body data-kind="unreachable" data-online="${online}">
<div class="bar">${
    controls
      ? `<button type="button" id="min" aria-label="${esc(t("minimise"))}" title="${esc(t("minimise"))}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button><button type="button" id="close" aria-label="${esc(t("close"))}" title="${esc(t("close"))}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>`
      : ""
  }</div>
<main class="box">
  <div class="mark" aria-hidden="true">${logoStill}</div>
  <h1 role="status" aria-live="polite"><span class="dot"></span><span id="title">${esc(t(online ? "unreachable" : "noNetwork"))}</span></h1>
  <p id="sub">${esc(t(online ? "unreachableSub" : "noNetworkSub"))}</p>
  <button class="btn" type="button" id="retry">${esc(t("retryNow"))}</button>
</main>
<script>
(() => {
  const n = window.native || {};
  const on = (id, run) => { const el = document.getElementById(id); if (el) el.addEventListener("click", run); };
  on("min", () => n.minimise && n.minimise());
  on("close", () => n.close && n.close());
  on("retry", () => {
    const b = document.getElementById("retry");
    b.disabled = true;
    setTimeout(() => { b.disabled = false; }, 2000);
    n.retryLoad && n.retryLoad();
  });
})();
</script>
</body>
</html>`;
}

/**
 * Watches the app window's loads. `home` is the app's address; `ready` is
 * called when the window has something to show (this page counts).
 */
export function installUnreachablePage(
  window: BrowserWindow,
  home: URL,
  options: { controls: boolean; ready: () => void },
) {
  let target: string | undefined; // the app address to open once it answers
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownOnline: boolean | undefined;
  let probing = false;

  const showing = () => target !== undefined;

  function show(url: string) {
    if (window.isDestroyed()) return;
    if (!showing()) attempt = 0;
    target = url.startsWith(home.origin) ? url : home.toString();
    const online = net.isOnline();
    if (
      shownOnline !== online ||
      !window.webContents.getURL().startsWith(PAGE_PREFIX)
    ) {
      shownOnline = online;
      window.webContents
        .loadURL(
          PAGE_PREFIX +
            encodeURIComponent(page(shellLanguage(), online, options.controls)),
        )
        .catch(() => undefined);
    }
    options.ready();
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(probe, nextRetryDelay(attempt++));
  }

  /** Asks the address quietly; the window only changes when it answers */
  async function probe() {
    if (!showing() || probing || window.isDestroyed()) return;
    probing = true;
    let ok = false;
    try {
      const response = await net.fetch(home.toString(), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      ok = response.status < 500;
    } catch {
      ok = false;
    }
    probing = false;
    if (window.isDestroyed() || !showing()) return;
    if (ok) {
      const url = target as string;
      target = undefined;
      shownOnline = undefined;
      clearTimeout(timer);
      window.webContents.loadURL(url).catch(() => undefined);
    } else {
      // the wording follows the network state (no network / site down)
      if (shownOnline !== net.isOnline()) show(target as string);
      else schedule();
    }
  }

  window.webContents.on(
    "did-fail-load",
    (_event, code, _text, url, isMainFrame) => {
      // -3: the load was replaced by another one, not a failure
      if (!isMainFrame || code === -3 || url.startsWith("data:")) return;
      show(url);
    },
  );
  // the address answered, but with a server fault (502, 503, 521 …)
  window.webContents.on("did-navigate", (_event, url, status) => {
    if (status >= 500 && url.startsWith(home.origin)) show(url);
  });
  window.on("closed", () => clearTimeout(timer));

  ipcMain.on("retryLoad", (event) => {
    if (window.isDestroyed() || event.sender !== window.webContents) return;
    attempt = 0;
    clearTimeout(timer);
    probe();
  });
}
