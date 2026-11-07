import { defineConfig } from "vite";

import { buildDefine, readReleaseInfo } from "./scripts/release-info.mjs";

import { resolveApplicationUrl } from "./src/native/applicationUrl";

const applicationUrl = process.env.ZRZUR_DESKTOP_URL || "";
if (process.env.ZRZUR_RELEASE_BUILD === "1") {
  resolveApplicationUrl({ packaged: true, bundled: applicationUrl });
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(applicationUrl).hostname.replace(/\.$/, ""),
    )
  ) {
    throw new Error(
      "Official builds require the approved public Zrzur application URL.",
    );
  }
}

// https://vitejs.dev/config
export default defineConfig({
  define: {
    __ZRZUR_APP_URL__: JSON.stringify(applicationUrl),
    // version + git commit + tag; the About panel links to this source
    __ZRZUR_BUILD__: buildDefine(readReleaseInfo({ dir: __dirname }), "desktop"),
  },
  build: {
    rollupOptions: {
      external: ["node-pipewire"],
    },
  },
});
