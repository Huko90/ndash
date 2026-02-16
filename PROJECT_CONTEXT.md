# nDash Project Context

Last updated: 2026-02-16

## What This Project Is
nDash is a dashboard app that combines:
- Crypto market view (Binance BTC ticker + chart + alerts)
- Weather view (Open-Meteo + geocoding helpers)
- PC telemetry view (CPU/GPU temps and load from Libre Hardware Monitor JSON)

It runs in two modes:
- Electron desktop app (primary distribution for Windows)
- Simple Python kiosk/LAN server mode (`serve.py`) for browser displays

## Runtime Architecture
- Frontend SPA shell: `index.html`, `js/app.js`
- Dash modules:
  - BTC: `js/btc.js`
  - Weather: `js/weather.js`
  - PC: `js/pc.js`
  - Stocks helper module exists: `js/stocks.js`
- Config layering:
  1. `js/config-base.js` defaults
  2. Desktop runtime JSON (`/btct-runtime-config.json`)
  3. Local runtime overrides in browser storage

## Desktop Side
- Electron entrypoint: `desktop/main.js`
- Local HTTP/HTTPS server/proxies: `desktop/local-server.js`
- Config storage: `desktop/config-store.js`
- Setup wizard: `desktop/wizard.html`
- IPC bridge: `desktop/preload.js`

## API/Proxy Endpoints
Exposed by desktop local server and/or kiosk server:
- `/health`
- `/btct-runtime-config.json`
- `/api/pc`
- `/api/stocks/*`
- `/dashboard-cert.crt` (desktop local server)

## Release and Update Flow
- Release workflow: `.github/workflows/win-release.yml`
- Release command: `./scripts/release.sh vX.Y.Z`
- Windows artifacts expected on releases:
  - `nDash-Setup-<version>.exe`
  - `latest.yml`
  - `*.blockmap`

## Key Changes Made (This Session)

### Branding / Identity
- Rebranded user-facing app name to **nDash** across app UI and docs.
- Updated package metadata:
  - `name`: `ndash-desktop`
  - `appId`: `com.ndash.desktop`
  - `productName`: `nDash`
- Updated installer artifact naming to:
  - `nDash-Setup-${version}.${ext}`
- Updated local cert common name to `ndash.local`.

### Service Rename
- Renamed systemd unit file from `btcticker.service` to `ndash.service`.
- Docs updated to reference `ndash.service`.

### Updater Reliability
- NSIS config changed for smoother updater UX:
  - `oneClick: true`
  - `allowToChangeInstallationDirectory: false`
- GitHub Actions install step now retries `npm ci` (up to 3 attempts) to handle transient Electron CDN/502 failures.

### Settings UX
- Settings drawer reorganized into tabs:
  - General
  - Data Sources
  - Alerts
  - Display
  - System
- Added collapsed **Advanced Controls** section for less-used actions.

### Weather / Mobile Responsiveness Work
- Weather hero sizing and centering were iterated heavily.
- Added phone-specific breakpoints and scroll/safe-area handling to reduce clipping.
- Added mobile resilience for weather panel and overall app shell scroll behavior.

### BTC Mobile Layout
- Added phone-specific BTC layout fallback to preserve chart visibility on smaller screens.

## Current Operational Notes
- Tablet and phone layouts may still require visual tuning depending on browser chrome and device aspect ratio.
- Static assets are served with short cache windows; after CSS changes, force-refresh clients or wait for cache expiry.

## Common Commands
- Start desktop app: `npm start`
- Force wizard: `npm run wizard`
- Syntax sanity: `npm run lint:syntax`
- Smoke test: `npm run test:smoke`
- Release: `./scripts/release.sh vX.Y.Z`

## Quick Troubleshooting
- If release tag mismatch fails CI:
  - Ensure tag matches `package.json` version exactly (`v<same-version>`).
- If updater shows 404:
  - Verify `latest.yml` path matches the uploaded `.exe` filename exactly.
- If HTTPS works on Pi but fails on tablet:
  - Check certificate trust on device and clear stale cert/site trust entries.

