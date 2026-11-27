# PIDOR ONLINE — deployed production P59

**This directory contains the current production code as exported from the Cloudflare Worker `pidor` on 2026-11-27.** It is an exact **runtime-code snapshot**, not a recreation from the older files in `client/` and `server/`.

The published Mini App is served at https://pidor.uvidimsyamd.workers.dev/api/app.

## Files

- `worker-template.js` — the deployed Cloudflare Worker runtime (including multiplayer rooms, server game rules, penalty logic and API handlers), with only the embedded frontend/CSS string values replaced by two rebuild placeholders.
- `frontend.js` — the **exact P59 released frontend JavaScript** previously embedded as `RELEASE_JS`.
- `frontend.css` — the **exact P59 released stylesheet** previously embedded as `RELEASE_CSS`.
- `build-worker.mjs` — reconstructs the deployed production Worker byte-for-byte at the JavaScript-string level without changing the game logic.
- `assets/cards/` — all 36 released WebP card faces (9 ranks × 4 suits) and `BACK_COMMON.webp`, copied from the live site's static assets.
- `assets/manifest.json` — SHA-256 checksums and sizes for all 37 images.
- `sync-assets.py` — downloader for re-synchronizing WebP assets from production.

Run from the repository root with Node.js 20+:

```sh
node production/P59/build-worker.mjs
```

Output: `production/P59/dist/cloudflare-worker.js`. The build script verifies the expected lengths of all components and the reconstructed P59 Worker. No npm installation is required for this reconstruction.

## Card assets

All **37 referenced image files** have been copied from the deployed site into `assets/cards/`: `/cards/BACK_COMMON.webp` plus `/cards/{06,07,08,09,10,J,Q,K,A}_{H,D,C,S}.webp`. Total image bytes: **2,326,826**. The download validates WebP signatures and MIME types; `assets/manifest.json` records each file's SHA-256.

Re-download when needed with:

```sh
python3 production/P59/sync-assets.py
```

The current frontend renders effects/sound programmatically and includes the favicon inline, rather than loading separate audio/font/icon files.

## Source-of-truth warning

The older modular `client/`, `server/` and `shared/` directories on this branch are from the **legacy implementation** and do **not** currently reproduce the published Cloudflare version. For fixes to the live P59, start from the files in this directory; do not deploy the legacy app by accident.

These are deployable runtime JavaScript/CSS snapshots, **not** the original maintainable Vue SFC / TypeScript source files. Restoring a modular source project is a separate migration.

The Cloudflare Worker also depends on external bindings `ASSETS`, `LOBBY`, `ROOMS`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET`. This snapshot contains **no values for those secrets** and does not store any secret values. The 37 WebP card images used by the current frontend are now backed up in `assets/cards/`. On a fresh account, restore the `ASSETS`, `LOBBY` and `ROOMS` bindings and secret environment values separately.

The P59 snapshot was captured from the published Worker, **not from the staging UI Worker**. This GitHub commit is a backup/synchronization of production code; uploading it to GitHub has not changed the currently deployed Cloudflare game.
