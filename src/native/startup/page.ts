/**
 * The start-up window's page, as one self-contained document: no file, no
 * network request, nothing to wait for. The logo files are the delivered
 * ones, placed in the page unchanged (assets/startup/, see its README).
 *
 * Colours are the Midnight Pulse tokens of brand.md: ground #0D0E16, the one
 * action colour #E0195F for the bar and the filled button, amber for the
 * warning mark, coral for the error mark. Flat: no glow, gradient or shadow.
 */
import monoFont from "../../../assets/startup/fonts/ibm-plex-mono-latin-400-normal.woff2?inline";
import arabicFont from "../../../assets/startup/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2?inline";
import arabicFontMedium from "../../../assets/startup/fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2?inline";
import cyrillicFont from "../../../assets/startup/fonts/ibm-plex-sans-cyrillic-wght-normal.woff2?inline";
import sansFont from "../../../assets/startup/fonts/ibm-plex-sans-latin-wght-normal.woff2?inline";
import logoMoving from "../../../assets/startup/logo-glide.svg?raw";
import logoStill from "../../../assets/startup/logo.svg?raw";

import type { StartupView } from "./startupStrings";

export const STARTUP_GROUND = "#0D0E16";
// a small upright window, not a wide one (owner, 2026-11-16)
export const STARTUP_WIDTH = 320;
export const STARTUP_HEIGHT = 380;

// the range the font package itself declares for this file
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";

const face = (family: string, weight: string, url: string, range?: string) =>
  `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url("${url}") format("woff2")${range ? `;unicode-range:${range}` : ""}}`;

const CSS = `
:root{--frame:${STARTUP_GROUND};--raised:#242638;--border-soft:#303348;--floating:#11121C;--hairline:rgb(255 255 255 / .06);
--fg:#F0F1F8;--fg2:#A1A5B8;--muted:#8C90A6;--action:#E0195F;--action-hover:#C8155A;--action-pressed:#B0124F;--selected:#303348;--warn:#F3B96B;--error:#F27488}
*{box-sizing:border-box;margin:0}
html,body{background:var(--frame);overflow:hidden}
body{color:var(--fg);font-family:"IBM Plex Sans","Microsoft YaHei UI","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;-webkit-app-region:drag;user-select:none;cursor:default}
[dir=rtl] body{font-family:"IBM Plex Sans Arabic","IBM Plex Sans",system-ui,sans-serif}
.win{width:${STARTUP_WIDTH}px;min-height:${STARTUP_HEIGHT}px;padding:20px 24px 24px;display:flex;flex-direction:column;box-shadow:inset 0 0 0 1px var(--hairline)}
.top{display:flex;justify-content:space-between;align-items:center;font-size:12px;line-height:16px;color:var(--muted)}
.ver{font-family:"IBM Plex Mono",ui-monospace,monospace;direction:ltr}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;padding-top:4px}
.mark{width:136px;height:136px;margin:0 auto 4px;display:grid;place-items:center}
.mark span{display:block;line-height:0}
.mark svg{display:block}
#moving svg{width:136px;height:136px}
/* the still file has no margin around the face: same face size as the moving one */
#still svg{width:115px;height:115px}
.title{font-size:15px;line-height:22px;font-weight:500;text-align:center}
[dir=rtl] .title{line-height:24px}
.title,.sub{text-wrap:balance}
.sub{font-size:13px;line-height:20px;color:var(--fg2);text-align:center;margin-top:4px;min-height:40px}
[dir=rtl] .sub{line-height:22px;min-height:44px}
.dot{display:none;width:8px;height:8px;border-radius:999px;margin-inline-end:8px;vertical-align:1px}
[data-tone=warn] .dot{display:inline-block;background:var(--warn)}
[data-tone=error] .dot{display:inline-block;background:var(--error)}
.foot{padding-top:16px;min-height:48px}
.track{height:4px;border-radius:999px;background:var(--raised);overflow:hidden}
.fill{height:100%;width:0;background:var(--action);border-radius:999px;transition:width 120ms linear}
.meter{display:flex;justify-content:space-between;margin-top:8px;font-size:12px;line-height:16px;color:var(--muted)}
.meter .num{font-variant-numeric:tabular-nums}
.pct{color:var(--fg);font-family:"IBM Plex Mono",ui-monospace,monospace;direction:ltr}
.actions{display:flex;flex-direction:column;gap:8px;align-items:stretch}
button{font:inherit;cursor:pointer;-webkit-app-region:no-drag}
.btn{height:36px;padding:0 16px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;line-height:1;border:1px solid transparent;color:#fff;background:var(--action)}
.btn:hover{background:var(--action-hover)}
.btn:active{background:var(--action-pressed)}
.btn.second{background:var(--raised);border-color:var(--border-soft);color:var(--fg)}
.btn.second:hover,.btn.second:active{background:var(--selected)}
.link{align-self:center;background:none;border:0;padding:4px 8px;border-radius:6px;font-size:13px;color:var(--fg2);text-decoration:underline;text-underline-offset:3px}
.link:hover{color:var(--fg)}
:focus-visible{outline:2px solid var(--action);outline-offset:2px}
.details{margin-top:12px;background:var(--floating);border:1px solid var(--hairline);border-radius:10px;padding:12px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;line-height:18px;color:var(--fg2);direction:ltr;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;cursor:text;-webkit-app-region:no-drag;max-height:120px;overflow:auto}
[hidden]{display:none!important}
@media(prefers-reduced-motion:reduce){.fill{transition:none}}
`;

// Runs in the page. It only places ready-made words (textContent, never
// HTML) and reports clicks; every decision is made in the main process.
const SCRIPT = `
(() => {
  const $ = (id) => document.getElementById(id);
  let detailsOpen = false;
  function render(v) {
    const root = document.documentElement;
    root.lang = v.lang; root.dir = v.dir;
    document.body.dataset.kind = v.kind;
    document.body.dataset.tone = v.tone;
    $("name").textContent = v.name;
    $("ver").textContent = v.version;
    $("moving").hidden = !v.moving;
    $("still").hidden = v.moving;
    $("title-text").textContent = v.title;
    $("sub").textContent = v.sub;
    $("progress").hidden = !v.progress;
    if (v.progress) {
      $("fill").style.width = v.progress.percent + "%";
      $("bar").setAttribute("aria-valuenow", String(v.progress.percent));
      $("bar").setAttribute("aria-label", v.title);
      $("bytes").textContent = v.progress.bytes;
      $("pct").textContent = v.progress.label;
    } else {
      $("fill").style.width = "0";
    }
    $("failed").hidden = !v.failed;
    if (v.failed) {
      $("open").textContent = v.failed.open;
      $("retry").textContent = v.failed.retry;
      $("details").textContent = v.failed.details;
      $("text").textContent = v.failed.text;
    } else if (detailsOpen) {
      setDetails(false);
    }
    report();
  }
  function setDetails(open) {
    detailsOpen = open;
    $("text").hidden = !open;
    $("details").setAttribute("aria-expanded", String(open));
    window.startup && window.startup.detailsOpen(open);
    report();
  }
  function report() {
    window.startup && window.startup.height(Math.ceil($("win").getBoundingClientRect().height));
  }
  $("open").addEventListener("click", () => window.startup.choose("open"));
  $("retry").addEventListener("click", () => window.startup.choose("retry"));
  $("details").addEventListener("click", () => setDetails(!detailsOpen));
  render(JSON.parse($("first").textContent));
  window.startup && window.startup.onView(render);
})();
`;

/** The page with its first state already in it, so the first paint is complete */
export function startupPage(first: StartupView): string {
  const fonts = [
    face("IBM Plex Sans", "100 700", sansFont),
    face("IBM Plex Mono", "400", monoFont),
    // only the script this language needs is put into the page
    ...(first.lang === "ar"
      ? [
          face("IBM Plex Sans Arabic", "400", arabicFont),
          face("IBM Plex Sans Arabic", "500", arabicFontMedium),
        ]
      : []),
    ...(first.lang === "ru"
      ? [face("IBM Plex Sans", "100 700", cyrillicFont, CYRILLIC)]
      : []),
  ].join("");
  const json = JSON.stringify(first).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${first.lang}" dir="${first.dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${first.name}</title>
<style>${fonts}${CSS}</style>
</head>
<body>
<main class="win" id="win">
  <div class="top"><span id="name"></span><span class="ver" id="ver"></span></div>
  <div class="mid">
    <div class="mark" aria-hidden="true"><span id="moving">${logoMoving}</span><span id="still" hidden>${logoStill}</span></div>
    <div class="title" role="status" aria-live="polite"><span class="dot"></span><span id="title-text"></span></div>
    <div class="sub" id="sub"></div>
  </div>
  <div class="foot">
    <div id="progress" hidden>
      <div class="track" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fill" id="fill"></div></div>
      <div class="meter"><span class="num" id="bytes"></span><span class="pct" id="pct"></span></div>
    </div>
    <div id="failed" hidden>
      <div class="actions"><button class="btn" id="open" type="button"></button><button class="btn second" id="retry" type="button"></button><button class="link" id="details" type="button" aria-expanded="false" aria-controls="text"></button></div>
      <pre class="details" id="text" hidden></pre>
    </div>
  </div>
</main>
<script type="application/json" id="first">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}
