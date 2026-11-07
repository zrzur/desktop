<!-- zrzur-publication -->
# Quick start

```bash
git clone https://github.com/zrzur/desktop.git
cd desktop
corepack enable
pnpm install --frozen-lockfile
node --test test/*.test.mjs
pnpm package
```

Needs Git and Node.js 24.

Zrzur is an independent, Arabic-first chat platform based on the open-source Stoat software (formerly Revolt), licensed under AGPL-3.0 or later. Zrzur is not affiliated with Stoat, stoat.chat or Revolt Platforms Ltd. Please do not report Zrzur issues to the Stoat team.

Licence and origin: [LICENSE](./LICENSE), [NOTICE](./NOTICE), [MODIFICATIONS.md](./MODIFICATIONS.md). Security: [SECURITY.md](./SECURITY.md). Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md).

> **Zrzur 26.0.0-dev · main · development source.** See [shared release information](ZRZUR_RELEASE.md).

<div align="center">

# Zrzur Desktop

Electron application for Windows, macOS, and Linux — **Zrzur 26**.

</div>

<br/>

## Purpose

Zrzur Desktop is the desktop client for Zrzur. It runs the web client inside an Electron shell (window, tray, and packaging).

## Architecture

- Electron + Electron Forge
- Loads a local or remote Zrzur Web build
- App ID: `cc.zrzur.ZrzurDesktop`
- Tooling: mise, pnpm

## Supported platforms

| Platform | Notes |
| --- | --- |
| Windows | Forge distributables |
| macOS | Forge distributables |
| Linux | Forge packages; Flatpak helpers available |

## Installation

Signed public downloads are not published yet. Build from this repository for now.

## Development

```bash
git clone https://github.com/zrzur/desktop.git
cd desktop

mise install
mise install:frozen

mise dev          # run
mise build        # bundle
mise make         # distributables
```

### Local web client

```bash
mise exec -- pnpm start -- --force-server http://localhost:5173
```

### Flatpak

```bash
mise exec -- pnpm install:flatpak
mise exec -- pnpm run:flatpak
mise exec -- pnpm run:flatpak --force-server http://localhost:5173
```

### Nix

```bash
nix develop
pnpm package
pnpm run:nix
pnpm run:nix --force-server=http://localhost:5173
```

## Local stack

1. Start the [backend](https://github.com/zrzur/backend) (API on `14702` in the default local layout).
2. Start [web](https://github.com/zrzur/web) against that API.
3. Launch Desktop with `--force-server` pointing at the web origin.

## Updates

Auto-update is disabled until a Zrzur update channel exists.

## Troubleshooting

- Blank window: check that the URL passed to `--force-server` is reachable.
- Use the mise-managed Node/pnpm versions from this repository.

## Contributing

Issues and pull requests on this repository after it is published under [github.com/zrzur](https://github.com/zrzur). Keep changes focused and preserve AGPL attribution.

## License

[AGPL](./LICENSE).

## Upstream Project & Attribution

Zrzur Desktop is an independent AGPL desktop client. Open-source history, copyright and licensing are preserved in LICENSE/NOTICE. Upstream projects do not sponsor or endorse Zrzur.

- Upstream: https://github.com/stoatchat/for-desktop
- Basis tag: `v1.5.4`
- License: AGPL (see [LICENSE](./LICENSE))
