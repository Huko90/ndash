# BTC Tracker Runbook

Single operational reference for desktop packaging, kiosk hosting, and troubleshooting.

## 1. Desktop (Windows) Build + Install

1. On your build machine:
   - `cmd /c npm install`
   - `cmd /c npm run dist:win`
2. Send the generated installer from `dist/` to users.
3. On first launch, complete the setup wizard.

## 2. Libre Hardware Monitor Source PC

1. Install Libre Hardware Monitor.
2. Run as Administrator.
3. Set:
   - Network Interface: `0.0.0.0`
   - Port: `8085`
4. Enable Remote Web Server.
5. Verify source endpoint from dashboard host:
   - `http://<SOURCE_PC_IP>:8085/data.json`

## 3. Kiosk / Pi Hosting

Use `serve.py` for LAN hosting.

1. Start manually:
   - `python3 serve.py`
2. Or systemd:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl restart btcticker.service`
   - `sudo systemctl status btcticker.service`

Important env vars:
- `BTCT_PC_ENDPOINT`: upstream Libre endpoint
- `BTCT_STOCKS_API_KEY`: Polygon key (optional, only if using stocks APIs)
- `BTCT_STOCKS_API_BASE`: optional override
- `BTCT_ALLOW_STOCKS_KEY_QUERY`: default `0` (recommended). Set `1` only for temporary debugging.

## 4. Health + Diagnostics

Both desktop local server and `serve.py` expose:
- `GET /health`

Includes:
- `uptimeMs`
- request count
- API success/error counters (`pc`, `stocks`)
- last error metadata

Desktop Settings now shows a compact health summary line.

## 5. PC Temp Dashboard Troubleshooting

If PC panel shows online but missing temps:
1. Confirm `/api/pc` returns JSON.
2. Ensure Libre sensor labels include expected CPU/GPU temp/load names.
3. Optional debug mode:
   - set runtime override `pc.debug = true`
   - check console warnings for sampled sensor labels

If temps reach `100°+`:
- Current build includes 3-digit temp rendering support (`100°`, `105°`, etc.).

## 6. Stocks API Security Note

Default behavior is now safer:
- Server-side env key is preferred.
- Query-string `apiKey` is ignored unless `BTCT_ALLOW_STOCKS_KEY_QUERY=1`.

This avoids accidental key leakage in URLs/logs.

## 7. Verification Commands

1. Syntax sanity:
   - `npm run lint:syntax`
2. Smoke test (starts local server, checks key endpoints):
   - `npm run test:smoke`

## 8. Windows Signing + Auto-Update Channel

### Build commands

- Local unsigned build:
  - `npm run dist:win`
- Release build + publish:
  - `npm run dist:win:publish`

### Code signing env vars (Windows)

Set before running release build:
- `CSC_LINK`: base64 `.pfx` content or path/URL to cert
- `CSC_KEY_PASSWORD`: password for `.pfx`
- optional timestamp:
  - `WIN_CSC_LINK`
  - `WIN_CSC_KEY_PASSWORD`

If signing vars are missing, you can still build locally, but SmartScreen trust will be weaker.

### Auto-update runtime env vars

Set on client machines (or app launch environment):
- `BTCT_UPDATE_URL`: base URL hosting update artifacts (required)
- `BTCT_UPDATE_CHANNEL`: optional channel name (default `latest`)
- `BTCT_DISABLE_AUTO_UPDATE=1`: force-disable updater

### Update host contents

Host files produced in `dist/` from published build:
- installer `.exe`
- blockmap files
- `latest.yml` (required by electron-updater generic provider)

Client behavior:
- checks on startup and every 6 hours
- downloads in background
- prompts user to restart when update is ready

## 9. Free GitHub Release Pipeline (Recommended)

Use GitHub as the source of truth and release host:
- Pi = edit code + push commits
- GitHub Actions = builds Windows `.exe` on tag
- Friends = download from Releases latest page

Workflow file:
- `.github/workflows/win-release.yml`

### One-time setup

1. Create empty GitHub repo.
2. In project folder on Pi:
   - `git init`
   - `git add .`
   - `git commit -m "Initial import"`
   - `git branch -M main`
   - `git remote add origin https://github.com/<you>/<repo>.git`
   - `git push -u origin main`

### Normal update flow (Pi)

1. Commit and push code changes:
   - `git add .`
   - `git commit -m "Update dashboard"`
   - `git push`
2. When you want a downloadable EXE release:
   - `git tag v1.0.1`
   - `git push origin v1.0.1`
3. GitHub Actions builds and publishes release assets automatically.

### Friend download link

- Latest release page:
  - `https://github.com/<you>/<repo>/releases/latest`

Friends open that URL and download the newest `.exe`.
