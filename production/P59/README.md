# PIDOR ONLINE — deployed production P59

**This directory contains the current production code as exported from the Cloudflare Worker `pidor` on 2026-11-27.** It is an exact **runtime-code snapshot**, not a recreation from the older files in `client/` and `server/`.

The published Mini App is served at https://pidor.uvidimsyamd.workers.dev/api/app.

## Files

- `worker-template.js` — the deployed Cloudflare Worker runtime (including multiplayer rooms, server game rules, penalty logic and API handlers), with only the embedded frontend/CSS string values replaced by two rebuild placeholders.
- `frontend.js` — the **exact P59 released frontend JavaScript** previously embedded as `RELEASE_JS`.
- `frontend.css` — the **exact P59 released stylesheet** previously embedded as `RELEASE_CSS`.
- `build-worker.mjs` — reconstructs the deployed production Worker byte-for-byte at the JavaScript-string level without changing the game logic.

Run from the repository root with Node.js 20+:

```sh
node production/P59/build-worker.mjs
```

Output: `production/P59/dist/cloudflare-worker.js`. The build script verifies the expected lengths of all components and the reconstructed P59 Worker. No npm installation is required for this reconstruction.

## Source-of-truth warning

The older modular `client/`, `server/` and `shared/` directories on this branch are from the **legacy implementation** and do **not** currently reproduce the published Cloudflare version. For fixes to the live P59, start from the files in this directory; do not deploy the legacy app by accident.

These are deployable runtime JavaScript/CSS snapshots, **not** the original maintainable Vue SFC / TypeScript source files. Restoring a modular source project is a separate migration.

The Cloudflare Worker also depends on external bindings `ASSETS`, `LOBBY`, `ROOMS`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET`. This snapshot contains **no values for those secrets** and **does not export static image assets** managed by the `ASSETS` binding (including card images). Deploying the code to a fresh account requires restoring those external resources and configuration.

The P59 snapshot was captured from the published Worker, **not from the staging UI Worker**. This GitHub commit is a backup/synchronization of production code; uploading it to GitHub has not changed the currently deployed Cloudflare game.
