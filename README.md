<div align="center">

# Zarzour Desktop

Electron application for Windows, macOS, and Linux — **Zarzour 26**.

</div>

<br/>

## Purpose

Zarzour Desktop wraps the Zarzour web client in an Electron shell with native windowing, tray behavior, and desktop packaging. Product name, icons, Flatpak ID, and default load URL are Zarzour / localhost.

## Architecture

- **Shell:** Electron + Electron Forge
- **UI content:** loads a local or remote Zarzour Web build
- **Identity:** `cc.zarzour.ZarzourDesktop` (desktop entry / Flatpak / metainfo)
- **Tooling:** mise, pnpm

## Supported platforms

| Platform | Notes |
| --- | --- |
| Windows | Forge distributables |
| macOS | Forge distributables |
| Linux | Forge packages; Flatpak helpers available |

## Installation

Public download pages and signed installers are **pending** until the owner publishes them. Build from source for now.

Do not use upstream Stoat download sites for Zarzour packaging.

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

### Connect to a local web client

```bash
# point at a Vite dev server (see Zarzour Web README)
mise exec -- pnpm start -- --force-server http://localhost:5173
```

### Flatpak helpers

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

## Local backend integration

1. Run [Zarzour Backend](https://github.com/zrzur/backend) (API on `14702` in the default local layout).
2. Run [Zarzour Web](https://github.com/zrzur/web) with fail-closed `VITE_*` pointing at that API.
3. Launch Desktop with `--force-server` against the web origin, or load a packaged web build configured for the same endpoints.

Never default the desktop shell to `stoat.chat` / `revolt.chat`.

## Packaging and identity

| Item | Value |
| --- | --- |
| Product name | Zarzour |
| Flatpak / desktop ID | `cc.zarzour.ZarzourDesktop` |
| Brand icons | Vendored under `assets/` |

## Updates

Auto-update against upstream GitHub feeds is **disabled** until a Zarzour-owned update channel exists.

## Troubleshooting

- **Blank window:** confirm the web server URL (`--force-server`) is reachable.
- **Wrong branding:** ensure `assets/` contains Zarzour icons, not upstream Stoat art.
- **Flatpak ID mismatch:** installers and metainfo must use `cc.zarzour.ZarzourDesktop`.
- **Build tooling:** use mise-managed Node/pnpm versions from this repository.

## Contributing

After publication under [github.com/zrzur](https://github.com/zrzur), open Issues and PRs on this repository. Preserve AGPL attribution; keep packaging and identity changes reviewable.

## License

[AGPL](./LICENSE).

## Upstream Project & Attribution

Zarzour Desktop is independently developed from the open-source Stoat desktop client. Stoat does not sponsor or endorse Zarzour.

- Upstream: https://github.com/stoatchat/for-desktop
- Basis tag: `v1.5.4`
- License: AGPL (see [LICENSE](./LICENSE))
