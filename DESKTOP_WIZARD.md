# nDash Desktop Packaging (Phase 1)

For current day-to-day operations, prefer `RUNBOOK.md`.

This project now includes an Electron scaffold with a first-run setup wizard.

## What exists now

- Electron shell (`desktop/main.js`)
- Config persistence (`desktop/config-store.js`)
- Built-in local HTTP+HTTPS server (`desktop/local-server.js`)
- First-run wizard UI (`desktop/wizard.html`)
- Preload bridge (`desktop/preload.js`)

## Wizard covers

1. Libre Hardware Monitor prerequisite explanation
2. PC endpoint + poll interval + endpoint diagnostics test
3. Weather location basics
4. Network ports and URL mode (HTTP/HTTPS)
5. Runtime mode (`app_open` vs `background` tray keepalive)
6. Certificate location and final URL actions

## Rerun setup wizard

Launch with:

```bash
npm run wizard
```

or programmatically via IPC action `wizard:rerun`.

Inside the dashboard UI, use Settings -> `Re-run Setup Wizard` (desktop package only).

## Run

```bash
npm install
npm start
```

## Release Builds

- Unsigned local package:
  - `npm run dist:win`
- Signed/published release package:
  - `npm run dist:win:publish`

Auto-update in packaged app is enabled when any one of these is configured:
- `BTCT_UPDATE_URL` (generic host),
- `BTCT_GH_OWNER` + `BTCT_GH_REPO` (GitHub Releases), or
- bundled `app-update.yml` metadata in the packaged app.

## Important notes

- `background` mode keeps server running while window is closed (tray mode). It is not yet an OS boot-time service installer.
- HTTPS currently uses a generated self-signed cert local to each machine.
- Windows installer build scaffold is included via `npm run dist:win` (electron-builder/NSIS).
- On ARM Linux hosts (like Raspberry Pi), NSIS finishing can fail; build on a Windows dev machine for final `.exe` installer output.
