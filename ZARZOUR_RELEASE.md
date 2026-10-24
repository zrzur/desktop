# Zarzour 26 — shared development version

This repository is one component of Zarzour. The shared product version is **26.0.0-dev**, on **main**. This is a development source snapshot, not a stable public-service release. Original dependency, SDK and protocol versions remain compatibility identifiers.

| Component | Source |
|---|---|
| Backend | https://github.com/zrzur/backend |
| Web | https://github.com/zrzur/web |
| Desktop | https://github.com/zrzur/desktop |
| Infrastructure | https://github.com/zrzur/infrastructure |

Upstream Stoat/Revolt history, authorship and licenses are retained. No history was squashed or force-pushed. Old local feature branches are retained as development references; main is the publication branch.

## Current limits

Local integration tests were exercised, but release readiness remains open: dependency advisories, production TLS/endpoints/email, attachment privacy policy, real multi-device voice, backups/restore, signed desktop installers/updates, and production acceptance require work. Do not publish development configuration or reuse demo credentials in production.

Inherited workflows are retained in upstream Git history and a private local archive, not shipped as inactive workflow copies: some assumed upstream private runners, private brand assets or upstream repository write access. The active workflow only checks source metadata; it is not evidence of full build/integration CI.
# Packaged application origin

Set `ZARZOUR_DESKTOP_URL` when building to embed the approved application URL. Set `ZARZOUR_RELEASE_BUILD=1` for official builds: missing URLs, upstream application origins, insecure HTTP and loopback origins fail the build. No public origin is selected in this repository. Confirm the real deployment before building a distributable installer.

Packaged applications without a configured origin fail closed rather than connecting to localhost. Local development retains `http://127.0.0.1:5173`; an explicit `--force-server` loopback override remains available for local packaged testing. Runtime overrides must pass origin validation. `node --test test/applicationUrl.test.mjs` checks resolution and rejection behavior; source CI runs it with Node 24.

The upstream AGPL license is included in packaged resources. These controls do not replace code signing, installer/update testing, production service verification or release acceptance.
