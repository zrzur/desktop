import { defineConfig } from "vite";

import { resolveApplicationUrl } from "./src/native/applicationUrl";

const applicationUrl = process.env.ZARZOUR_DESKTOP_URL || "";
if (process.env.ZARZOUR_RELEASE_BUILD === "1") {
  resolveApplicationUrl({ packaged: true, bundled: applicationUrl });
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(applicationUrl).hostname.replace(/\.$/, ""),
    )
  ) {
    throw new Error(
      "Official builds require the approved public Zarzour application URL.",
    );
  }
}

// https://vitejs.dev/config
export default defineConfig({
  define: { __ZARZOUR_APP_URL__: JSON.stringify(applicationUrl) },
  build: {
    rollupOptions: {
      external: ["node-pipewire"],
    },
  },
});
