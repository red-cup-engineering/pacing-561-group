# pacing-app (pacing.561.group)

The practitioner-facing, local-first pacing app for infection-associated chronic illness (ME/CFS, long COVID, and related post-exertional malaise conditions).
No accounts, no analytics, no server-side storage: every biometric observation a person enters stays in their own browser (`localStorage`) and never reaches this Worker, or any server, at all.
A person logs resting heart rate, HRV, sleep, and prior-day activity level; sees a rolling personal baseline, deviation scores, the Workwell resting-heart-rate heuristic, and conservative PEM risk flags, each carrying the same evidence label the compute layer returns, verbatim; and can export or import their whole history as JSON in the `nutrition-biometric-observation-v1` record shape, so the identical file can be handed to a clinician or to the paid agent API without re-entering anything.

## Five-custody thread

- **Science**: `../../../../../../../../science-services-section/services/natural-science-services-section/services/biological-science-services-section/services/medical-science-services-section/services/myalgic-encephalomyelitis-services-section/content/text/documents/articles/notes/2026/09/02/2026-09-02-note-on-biometric-guided-pacing-evidence.md` -- the cited evidence dossier every number this app shows traces back to.
- **Engineering**: `../../../../../../../../engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/personal-computer-systems-services-section/services/personal-health-computer-systems-engineering-services-section/services/pacing-intelligence-services-section` -- `@red-cup-engineering/pacing-intelligence-services-section` (pinned `0.1.1`), the pure, no-I/O math this app vendors verbatim into the browser bundle (`npm run build`, never a hand copy).
- **Operations**: `wrangler deploy` from this directory (after `npm run build`, which the `deploy` script already runs first).
  There is no CI for this app yet -- deploys are run by hand, the same as the sibling the pacing-intelligence offers of market.
  561.group.
- **561 Group**: this Worker itself, `pacing-561-group`, live at `pacing.561.group` and `pacing-561-group.<subdomain>.workers.dev`.
- **Public**: the receiver-visible wedge named in the field note below -- the smallest version of "describe and flag against baseline, cite everything, never diagnose," built on the evidence note's licensed capabilities.
  It is this app's agent-facing twin, market.
  561.group (`x402-services-section/apps/market-561-group`, whose catalog carries the pacing-intelligence offers), that sells the identical compute per-call over x402; this app is the free, human-facing surface over the same math.
  See the market analysis and BEAT hypothesis both surfaces answer to: `../../../../../../public-social-services-section/services/public-education-services-section/services/health-education-services-section/content/text/documents/articles/notes/2026/09/02/2026-09-02-note-on-the-pacing-app-field-and-our-position.md`.

## Privacy stance: nothing leaves the device

This app makes no `fetch`, no beacon, no analytics call, anywhere in its own code (`public/js/app.mjs`, `public/js/view-model.mjs`).
Every observation and note a person enters is written only to that browser's `localStorage`, under `pacing-app:observations` and `pacing-app:notes`.
The Worker (`src/worker.mjs`) does exactly one thing: hand every request to the static-assets binding.
There is no database, no KV, no Durable Object, and no server-side code path that ever sees a person's biometric data.
This is the same claim the app's own privacy banner makes to the person using it, and it is true by inspection of the two files above.

## Layout

- `src/worker.mjs` -- the whole server-side surface: delegate every request to the Workers Assets binding.
  No accounts, no state.
- `public/index.html`, `public/css/style.css` -- the page: large type, low motion, one-column-first, dark mode via `prefers-color-scheme`.
- `public/js/view-model.mjs` -- pure data shaping (record building, formatting, evidence-label pass-through, import validation, export shape).
  No DOM, no storage, no network, no clock.
  Covered by `node --test`.
- `public/js/app.mjs` -- the browser glue: wires `view-model.mjs` and the vendored compute module to the DOM and to `localStorage`.
  This app's only I/O boundary; exercised by hand and `npm run dev`, not `node --test`.
- `public/vendor/pacing-intelligence.mjs` -- **generated**, never hand-edited.
  `npm run build` (`scripts/build-vendor.mjs`) copies `@red-cup-engineering/pacing-intelligence-services-section`'s `src/pacing-intelligence.mjs` here byte-for-byte from `node_modules`, so the browser runs the identical published code the paid gateway runs.
- `src/worker.mjs`'s asset route and `public/js/view-model.mjs` are covered by `test/worker.test.mjs` and `test/view-model.test.mjs`.

## GUI framework evaluated, not used

`@red-cup-engineering/web-page-tiling-engine` (TUFTE, pinned at `0.7.0` on the registry; `play.561.group` consumes it for its game shelf) was evaluated per this build's brief.
TUFTE's actual surface -- server-rendered tiles, an authored workspace/topology model, tile-granular live-patch reducers -- answers a multi-pane, rearrangeable-dashboard problem this app does not have: one daily-entry form, one computed-today panel, one history table.
Pulling in a tiling/workspace engine for that shape is weird code for normie shit, not the reverse; this app ships plain semantic HTML/CSS/vanilla JS instead.
If a later revision grows genuinely tile-shaped panels (a rearrangeable multi-metric dashboard), TUFTE is the right thing to reach for then.

## Observation record shape

Every stored/exported/imported record is a `nutrition-biometric-observation-v1` record (`urn:red-cup-science:nutrition:biometric-observation:1.0.0`, owned by `nutrition-practice-computer`), the same shape `@red-cup-engineering/pacing-intelligence-services-section` and the pacing-intelligence offers of market.
561.group both expect.
This app writes four metric ids: `resting-heart-rate`, `hrv-rmssd`, `sleep-duration`, `activity-load`.
Notes are kept separately (`day -> text`, not part of the biometric-observation array, since the schema has no free-text field) and travel alongside the observations in this app's own export envelope (`{ kind: "pacing-app-history-export", exportVersion, exportedAt, observationCount, observations, notes }`).
The `observations` array on its own is exactly what the pacing-intelligence offers of market.
561.group's `POST /v1/pacing/analysis` body expects.

## Development

```bash
npm install
npm test            # runs `npm run build` first (pretest), then node --test
npm run dev          # builds vendor, then wrangler dev
```

## Deployment

```bash
npm run build && npx wrangler deploy
```

(`npm run deploy` runs both steps.)
No CI exists for this app yet; deploys are run by hand from this directory, the same operations pattern the pacing-intelligence offers of market.
561.group and `play.561.group` use.

## Ownership

- Product compute: Personal Health Computer Systems Engineering / Pacing Intelligence Services Section
- This app (free, human-facing surface): Public Health Services / Public Feng Shui Services / Public Health Pacer Services / pacing-app
