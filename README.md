<div align="center">

# Zarzour Desktop

Electron application for Windows, macOS, and Linux — **Zarzour 26**.

</div>

<br/>

## Purpose

Zarzour Desktop is the desktop client for Zarzour. It runs the web client inside an Electron shell (window, tray, and packaging).

## Architecture

- Electron + Electron Forge
- Loads a local or remote Zarzour Web build
- App ID: `cc.zarzour.ZarzourDesktop`
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

Auto-update is disabled until a Zarzour update channel exists.

## Troubleshooting

- Blank window: check that the URL passed to `--force-server` is reachable.
- Use the mise-managed Node/pnpm versions from this repository.

## Contributing

Issues and pull requests on this repository after it is published under [github.com/zrzur](https://github.com/zrzur). Keep changes focused and preserve AGPL attribution.

## License

[AGPL](./LICENSE).

## Upstream Project & Attribution

Zarzour Desktop is independently developed from the open-source Stoat desktop client. Stoat does not sponsor or endorse Zarzour.

- Upstream: https://github.com/stoatchat/for-desktop
- Basis tag: `v1.5.4`
- License: AGPL (see [LICENSE](./LICENSE))
