# Start-up window assets

Embedded into the start-up window's page (`src/native/startup/page.ts`). Nothing here is drawn or edited by hand.

| File | What | Source | Licence |
|---|---|---|---|
| `logo-glide.svg` | Zrzur logo, version B, white, with the approved `glide` loading motion | the delivered Zrzur logo package (`motion-v2/02-laugh-B-white-glide.svg`), copied unchanged | Zrzur trademark, not covered by AGPL-3.0 (see `NOTICE`) |
| `logo.svg` | The same logo, still | the delivered Zrzur logo package (`masters/02-laugh-B-white.svg`), copied unchanged | as above |
| `fonts/ibm-plex-sans-latin-wght-normal.woff2`, `…-cyrillic-…` | IBM Plex Sans, variable weight: Latin, Cyrillic (Russian) | npm `@fontsource-variable/ibm-plex-sans` 5.2.6, `files/` | SIL OFL 1.1 (`fonts/LICENSE-IBM-Plex-Sans-OFL.txt`) |
| `fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2`, `…-500-normal.woff2` | IBM Plex Sans Arabic, 400 and 500 | npm `@fontsource/ibm-plex-sans-arabic` 5.3.0, `files/` | SIL OFL 1.1 (`fonts/LICENSE-IBM-Plex-Sans-Arabic-OFL.txt`) |
| `fonts/ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono, Latin, 400 | npm `@fontsource/ibm-plex-mono` 5.2.6, `files/` | SIL OFL 1.1 (`fonts/LICENSE-IBM-Plex-Mono-OFL.txt`) |

The same font files ship in the Zrzur web client. Only the script a language needs is put into a page. IBM Plex has no Chinese: Simplified Chinese is drawn with the system's own face.

`../desktop/install.gif` (the Windows installer's animation) is rendered from `logo-glide.svg` on the ground colour `#0D0E16`, 320 × 380, one 2.4 s loop; nothing is drawn by hand.
