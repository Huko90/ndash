# BTC Tracker Operations Notes (2026-02-12)

For consolidated ongoing operations and troubleshooting, prefer `RUNBOOK.md`.

## What Changed

1. Created a rollback snapshot before changes:
   - `snapshots/pre_changes_20260212_141410.tar.gz`
2. Removed legacy backup/monolith files:
   - `btcultimate.html`
   - `btcultimate_backup.html`
   - `btcultimate_weather_backup.html`
3. Added frontend runtime config:
   - `js/config.js`
4. Weather location is no longer hardcoded in code logic:
   - `js/weather.js` now reads `window.BTCT_CONFIG.weather`
5. PC endpoint is no longer hardcoded in code logic:
   - `js/pc.js` now reads `window.BTCT_CONFIG.pc.endpoint`
6. Implemented Pi-side proxy endpoint:
   - `serve.py` now serves `/api/pc` and forwards to the main PC JSON source
7. Switched frontend PC endpoint to same-origin proxy:
   - `js/config.js` uses `pc.endpoint: '/api/pc'`
8. Added service-level endpoint config:
   - `btcticker.service` includes:
     - `Environment=BTCT_PC_ENDPOINT=http://192.168.0.118:8085/data.json`

## What Needs To Be Done (Now)

1. Reload systemd units:
   - `sudo systemctl daemon-reload`
2. Restart the dashboard service:
   - `sudo systemctl restart btcticker.service`
3. Verify service is healthy:
   - `sudo systemctl status btcticker.service`
4. Verify proxy works from tablet/Pi browser:
   - open `http://<PI_IP>:8888/api/pc`
   - expected: JSON payload from the main PC telemetry source

## Ongoing Maintenance

1. If main PC IP changes:
   - update `BTCT_PC_ENDPOINT` in `btcticker.service`
   - run daemon-reload + restart service
2. If weather location changes:
   - edit `js/config.js`:
     - `weather.name`
     - `weather.lat`
     - `weather.lon`
3. If restoring pre-change state is needed:
   - use `snapshots/pre_changes_20260212_141410.tar.gz`
