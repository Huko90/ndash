# Release Dashboard

## Current Process
- Release command: `./scripts/release.sh vX.Y.Z`
- CI workflow: `.github/workflows/win-release.yml`
- Latest download: `https://github.com/Huko90/ndash/releases/latest`

## Release Health Checklist
- Tag matches `package.json` version
- Workflow green on tag build
- Release contains `.exe`, `.yml`, `.blockmap`
- Manual app check reports either `up to date` or `downloading`

## If Update Fails
- Open tray -> `Open Update Log`
- In app Settings check updater status and last error
- Verify release is published (not draft)

## Rollback
- `./scripts/rollback-release.sh vX.Y.Z`
- Build from that tag and share installer manually if needed
