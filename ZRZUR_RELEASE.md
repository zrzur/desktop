# Zrzur 26 — shared development version

This repository is one component of Zrzur. The shared product version is **26.0.0-dev**, on **main**. This is a development source snapshot, not a stable public-service release. Original dependency, SDK and protocol versions remain compatibility identifiers.

| Component | Source |
|---|---|
| Backend | https://github.com/zrzur/backend |
| Web | https://github.com/zrzur/web |
| Desktop | https://github.com/zrzur/desktop |
| Self-hosted | https://github.com/zrzur/self-hosted |
| JavaScript SDK | https://github.com/zrzur/sdk-js |
| Website | https://github.com/zrzur/website |

Upstream licences, copyright notices and attribution are retained (see NOTICE). Git history was not carried over: this repository starts with a single initial commit.

## Current limits

Local integration tests were exercised, but release readiness remains open: dependency advisories, production TLS/endpoints/email, attachment privacy policy, real multi-device voice, backups/restore, signed desktop installers/updates, and production acceptance require work. Do not publish development configuration or reuse demo credentials in production.
# Packaged application origin

Set `ZRZUR_DESKTOP_URL` when building to embed the approved application URL. Set `ZRZUR_RELEASE_BUILD=1` for official builds: missing URLs, upstream application origins, insecure HTTP and loopback origins fail the build. No public origin is selected in this repository. Confirm the real deployment before building a distributable installer.

Packaged applications without a configured origin fail closed rather than connecting to localhost. Local development retains `http://127.0.0.1:5173`; an explicit `--force-server` loopback override remains available for local packaged testing. Runtime overrides must pass origin validation. `node --test test/applicationUrl.test.mjs` checks resolution and rejection behavior; source CI runs it with Node 24.

The upstream AGPL license is included in packaged resources. These controls do not replace code signing, installer/update testing, production service verification or release acceptance.
