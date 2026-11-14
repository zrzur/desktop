<!-- zrzur-publication -->
# Zrzur Desktop

The desktop app of [Zrzur](https://zrzur.com) for Windows, macOS and Linux. It shows [Zrzur Web](https://github.com/zrzur/web) inside an Electron window and adds what a browser cannot: a tray icon, system notifications, screen sharing and keys that work while a game is in front.

Part of Zrzur 26. Versions and the other components: [ZRZUR_RELEASE.md](./ZRZUR_RELEASE.md).

## Download

Installers for every system are at [zrzur.com/download](https://zrzur.com/download).

- The apps are not code-signed yet: Windows SmartScreen and macOS Gatekeeper ask before the first start.
- There is no automatic update yet. New versions are downloaded from the same page.
- The Linux app needs the system NSS libraries (`libnss3`).

## Quick start

```bash
git clone https://github.com/zrzur/desktop.git
cd desktop
corepack enable
pnpm install --frozen-lockfile
node --test test/*.test.mjs
pnpm package
```

Needs Git and Node.js 24.

## Development

The repository's tasks run with [mise](https://mise.jdx.dev/), which also installs the pinned tools.

```bash
mise install
mise install:frozen
```

| Task | What it does |
| --- | --- |
| `mise dev` | Run the app |
| `mise build` | Bundle it |
| `mise make` | Build the installers |

### With a local web app

1. Start the [backend](https://github.com/zrzur/backend) (API on port 14702 in the default local layout).
2. Start [web](https://github.com/zrzur/web) against that API.
3. Start Desktop and point it at the web app:

```bash
mise exec -- pnpm start -- --force-server http://localhost:5173
```

A blank window means the address given to `--force-server` cannot be reached.

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

## What is inside

- Electron with Electron Forge
- App ID: `cc.zrzur.ZrzurDesktop`
- Installers: Windows (Squirrel installer, zip), macOS (zip, Intel and Apple silicon), Linux (deb, zip; Flatpak helpers)

## Contributing and security

- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md). Keep changes focused and keep the attribution.
- Security reports: [SECURITY.md](./SECURITY.md).
- Changes: [CHANGELOG.md](./CHANGELOG.md).

## Licence and origin

Zrzur is an independent, Arabic-first chat platform based on the open-source Stoat software (formerly Revolt), licensed under AGPL-3.0 or later. Zrzur is not affiliated with Stoat, stoat.chat or Revolt Platforms Ltd. Please do not report Zrzur issues to the Stoat team.

- Licence: AGPL-3.0-or-later, see [LICENSE](./LICENSE).
- Upstream: [stoatchat/for-desktop](https://github.com/stoatchat/for-desktop), basis tag `v1.5.4`.
- Notices and changes: [NOTICE](./NOTICE), [MODIFICATIONS.md](./MODIFICATIONS.md), [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md).
