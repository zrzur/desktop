<div align="center">

<img src="../logo/03_APP_ICONS/black-circle/zarzour_black-circle_128.png" alt="Zarzour" width="96" height="96" />

# Zarzour Desktop

Electron application for Windows, macOS, and Linux — **Zarzour 26**.

</div>

<br/>

This tree is the Zarzour fork of Stoat `for-desktop` (AGPL). Product name, tray, installers, Flatpak IDs (`cc.zarzour.ZarzourDesktop`), and default load URL are Zarzour / localhost. Auto-update against upstream GitHub is **disabled** until a Zarzour update feed exists.

## Installation

Public download pages and signed installers for Zarzour are **pending** until the owner publishes them. Until then, build from this tree (see Development Guide).

Do not use upstream Stoat download links (`stoat.chat/download`) for Zarzour packaging.

## Development Guide

_Contribution guidelines for the desktop app: follow [`../CONTRIBUTING.md`](../CONTRIBUTING.md)._

Before getting started, you'll want to install:

- [Git](https://git-scm.com/install/)
- [mise-en-place](https://mise.jdx.dev/getting-started.html)

Then proceed to setup:

```bash
# From the Zarzour workspace root:
cd desktop

# Install tools from mise
mise install

# install all packages
mise install:frozen

# start the application
mise dev
# ... or build the bundle
mise build
# ... or build all distributables
mise make
```

Various useful commands for development testing:

```bash
# connect to the development server
mise exec -- pnpm start -- --force-server http://localhost:5173

# test the flatpak (after `make`)
mise exec -- pnpm install:flatpak
mise exec -- pnpm run:flatpak
# ... also connect to dev server like so:
mise exec -- pnpm run:flatpak --force-server http://localhost:5173

# Nix-specific instructions for testing
nix develop
pnpm package
pnpm run:nix
# ... as before:
pnpm run:nix --force-server=http://localhost:5173
# a better solution would be telling
# Electron Forge where system Electron is
```

### Brand assets

Zarzour brand icons are vendored under `assets/` (and workspace `../logo/`). The upstream Stoat assets submodule is not used.

If you need to refresh icons from the workspace brand kit:

```bash
# copy approved icons into desktop/assets as required by forge.config.ts
# (do not pull upstream Stoat marketing assets)
```

## Application identity

| Item | Value |
|---|---|
| Product name | Zarzour |
| Flatpak / desktop ID | `cc.zarzour.ZarzourDesktop` |
| Default load URL | localhost / configured Zarzour web host (fail closed) |
| Auto-update | Disabled pending Zarzour update feed |

## License

AGPL — see [LICENSE](./LICENSE).

## Upstream Project & Attribution

Zarzour Desktop is independently developed from the open-source Stoat desktop client. Stoat does not sponsor or endorse Zarzour.

- Upstream repository: https://github.com/stoatchat/for-desktop
- License: AGPL (see [LICENSE](./LICENSE))
- Pinned release: see `docs/UPSTREAM_LOCK.md` in the workspace root
