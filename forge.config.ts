import { MakerFlatpak } from "@electron-forge/maker-flatpak";
import { MakerFlatpakOptionsConfig } from "@electron-forge/maker-flatpak/dist/Config";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { generateThirdPartyNotices } from "./scripts/generate-third-party-notices.mjs";

const STRINGS = {
  author: "Zrzur",
  name: "Zrzur",
  execName: "zrzur-desktop",
  description: "Zrzur — community chat desktop client.",
};

const ASSET_DIR = "assets/desktop";
const NOTICES_FILE = "build/THIRD-PARTY-NOTICES.txt";

// the beta build must not register the stable app's link scheme
const linkScheme = /^https?:\/\/beta\./.test(process.env.ZRZUR_DESKTOP_URL ?? "")
  ? "zrzur-beta"
  : "zrzur";

/**
 * Build targets for the desktop app
 */
const zrzurIco = path.resolve(ASSET_DIR, "icon.ico");

const makers: ForgeConfig["makers"] = [
  {
    name: "@electron-forge/maker-squirrel",
    config: {
      // Keep nupkg id from package.json (zrzur_desktop). Do not set name here.
      authors: STRINGS.author,
      // Local Zrzur .ico — never remote Electron/Stoat icon hosts.
      iconUrl: pathToFileURL(zrzurIco).href,
      setupIcon: zrzurIco,
      description: STRINGS.description,
      exe: `${STRINGS.execName}.exe`,
      copyright:
        "Copyright (C) Zrzur; upstream Stoat/Revolt AGPL attributions preserved in LICENSE",
    },
  },
  {
    name: "@electron-forge/maker-zip",
    config: {},
  },
  // Debian and Ubuntu package; the app needs the system NSS libraries
  {
    name: "@electron-forge/maker-deb",
    platforms: ["linux"],
    config: {
      options: {
        name: STRINGS.execName,
        productName: STRINGS.name,
        bin: STRINGS.execName,
        maintainer: "Zrzur contributors",
        homepage: "https://zrzur.com",
        description: STRINGS.description,
        icon: `${ASSET_DIR}/icon.png`,
        categories: ["Network", "Chat"],
        section: "net",
        depends: ["libnss3", "libgtk-3-0", "libnotify4", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libsecret-1-0"],
        mimeType: [`x-scheme-handler/${linkScheme}`],
      },
    },
  },
  new MakerFlatpak({
    options: {
      id: "cc.zrzur.ZrzurDesktop",
      description: STRINGS.description,
      productName: STRINGS.name,
      productDescription: STRINGS.description,
      runtimeVersion: "25.08",
      icon: {
        "16x16": `${ASSET_DIR}/hicolor/16x16.png`,
        "32x32": `${ASSET_DIR}/hicolor/32x32.png`,
        "64x64": `${ASSET_DIR}/hicolor/64x64.png`,
        "128x128": `${ASSET_DIR}/hicolor/128x128.png`,
        "256x256": `${ASSET_DIR}/hicolor/256x256.png`,
        "512x512": `${ASSET_DIR}/hicolor/512x512.png`,
      } as unknown,
      categories: ["Network"],
      modules: [
        {
          name: "zypak",
          sources: [
            {
              type: "git",
              url: "https://github.com/refi64/zypak",
              tag: "v2025.09",
            },
          ],
        },
      ],
      finishArgs: [
        "--socket=fallback-x11",
        "--socket=wayland",
        "--share=ipc",
        "--share=network",
        "--device=dri",
        "--device=all",
        "--socket=pulseaudio",
        "--filesystem=xdg-run/pipewire-0",
        "--filesystem=xdg-videos:ro",
        "--filesystem=xdg-pictures:ro",
        "--filesystem=xdg-download",
        "--filesystem=xdg-run/speech-dispatcher",
        "--talk-name=org.freedesktop.ScreenSaver",
        "--talk-name=org.freedesktop.Notifications",
        "--talk-name=org.kde.StatusNotifierWatcher",
        "--talk-name=com.canonical.AppMenu.Registrar",
        "--talk-name=com.canonical.indicator.application",
        "--talk-name=com.canonical.Unity",
        "--env=XCURSOR_PATH=/run/host/user-share/icons:/run/host/share/icons",
      ],
      files: [],
    } as MakerFlatpakOptionsConfig,
  }),
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // THIRD-PARTY-NOTICES.txt is written by the generateAssets hook below
    extraResource: ["LICENSE", "NOTICE", NOTICES_FILE],
    name: STRINGS.name,
    executableName: STRINGS.execName,
    appBundleId: "cc.zrzur.ZrzurDesktop",
    // zrzur:// links from discover.zrzur.com and designs.zrzur.com (macOS)
    // (zrzur-beta:// when the build's application is beta.zrzur.com)
    protocols: [{ name: "Zrzur", schemes: [linkScheme] }],
    appCopyright:
      "Copyright (C) Zrzur; upstream Stoat/Revolt AGPL attributions preserved in LICENSE",
    win32metadata: {
      CompanyName: "Zrzur",
      FileDescription: STRINGS.description,
      OriginalFilename: `${STRINGS.execName}.exe`,
      ProductName: STRINGS.name,
      InternalName: STRINGS.execName,
    },
    // icon.ico (Windows), icon.icns (macOS), icon.png: the Zrzur logo B, from the delivered package
    icon: `${ASSET_DIR}/icon`,
  },
  rebuildConfig: {},
  makers,
  hooks: {
    // macOS: the app is signed again, ad hoc, once packaging is finished.
    // Packaging changes the bundle after Electron's own signature (fuses,
    // name, icon, Info.plist, the copied native modules), and a bundle whose
    // signature no longer matches is reported by macOS as "damaged" with no
    // way to open it. A valid ad-hoc signature turns that into the ordinary
    // "unidentified developer" question, which System Settings can answer.
    // A Developer ID signature (osxSign) replaces this once there is one.
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (platform !== "darwin" || process.platform !== "darwin") return;
      if (forgeConfig.packagerConfig.osxSign) return;
      for (const out of outputPaths) {
        for (const entry of fs.readdirSync(out)) {
          if (!entry.endsWith(".app")) continue;
          const app = path.join(out, entry);
          execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
            stdio: "inherit",
          });
          execFileSync(
            "codesign",
            ["--verify", "--deep", "--strict", "--verbose=2", app],
            { stdio: "inherit" },
          );
        }
      }
    },
    // licence text of every production dependency, shipped in the app resources
    generateAssets: async () => {
      generateThirdPartyNotices(path.resolve("."), path.resolve(NOTICES_FILE));
    },
    packageAfterCopy: async (_config, buildPath, _version, platform, arch) => {
      // Keys that work in games: the prebuilt listener (uiohook-napi, MIT;
      // it contains libuiohook, LGPL-3.0) for this system only, and the
      // small loader it needs. Nothing is compiled here.
      const prebuilt = `node_modules/uiohook-napi/prebuilds/${platform}-${arch}`;
      if (fs.existsSync(prebuilt)) {
        for (const file of ["package.json", "LICENSE", "dist"])
          fs.cpSync(
            `node_modules/uiohook-napi/${file}`,
            path.join(buildPath, "node_modules/uiohook-napi", file),
            { recursive: true },
          );
        fs.cpSync(prebuilt, path.join(buildPath, prebuilt), {
          recursive: true,
        });
        for (const file of [
          "package.json",
          "LICENSE",
          "index.js",
          "node-gyp-build.js",
        ])
          fs.cpSync(
            `node_modules/node-gyp-build/${file}`,
            path.join(buildPath, "node_modules/node-gyp-build", file),
          );
      }
      if (platform === "linux") {
        fs.cpSync(
          "node_modules/node-pipewire/dist",
          path.join(buildPath, "node_modules/node-pipewire/dist"),
          { recursive: true },
        );
        fs.cpSync(
          "node_modules/node-pipewire/LICENSE",
          path.join(buildPath, "node_modules/node-pipewire/LICENSE"),
          { recursive: true },
        );
        fs.cpSync(
          "node_modules/node-pipewire/package.json",
          path.join(buildPath, "node_modules/node-pipewire/package.json"),
          { recursive: true },
        );
      }
    },
  },
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          // keys that work in games: the listener's own process
          entry: "src/hookProcess.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  // Publisher intentionally omitted until Zrzur release infrastructure exists.
  publishers: [],
};

export default config;
