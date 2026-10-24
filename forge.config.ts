import { MakerFlatpak } from "@electron-forge/maker-flatpak";
import { MakerFlatpakOptionsConfig } from "@electron-forge/maker-flatpak/dist/Config";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import fs from "node:fs";
import path from "node:path";

const STRINGS = {
  author: "Zarzour",
  name: "Zarzour",
  execName: "zarzour-desktop",
  description: "Zarzour 26 — community chat desktop client.",
};

const ASSET_DIR = "assets/desktop";

/**
 * Build targets for the desktop app
 */
const makers: ForgeConfig["makers"] = [
  new MakerSquirrel({
    name: STRINGS.name,
    authors: STRINGS.author,
    // Local installer icon only — no remote Stoat iconUrl fetch.
    iconUrl: undefined as unknown as string,
    setupIcon: `${ASSET_DIR}/icon.ico`,
    description: STRINGS.description,
    exe: `${STRINGS.execName}.exe`,
    setupExe: `${STRINGS.execName}-setup.exe`,
    copyright:
      "Copyright (C) Zarzour; upstream Stoat/Revolt AGPL attributions preserved in LICENSE",
  }),
  new MakerZIP({}),
  new MakerFlatpak({
    options: {
      id: "cc.zarzour.ZarzourDesktop",
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
    extraResource: ["LICENSE"],
    name: STRINGS.name,
    executableName: STRINGS.execName,
    icon:
      process.platform === "darwin"
        ? `${ASSET_DIR}/icon.icon`
        : `${ASSET_DIR}/icon`,
  },
  rebuildConfig: {},
  makers,
  hooks: {
    packageAfterCopy: async (_config, buildPath, _version, platform) => {
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
  // Publisher intentionally omitted until Zarzour release infrastructure exists (class E).
  publishers: [],
};

export default config;
