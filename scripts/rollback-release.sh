#!/usr/bin/env bash
set -euo pipefail

tag="${1:?Usage: ./scripts/rollback-release.sh v1.0.6}"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Tag must be semver like v1.0.6"
  exit 1
fi

echo "Rolling back working tree to ${tag} (detached HEAD)."
git fetch --tags origin
git checkout "$tag"
echo "Now at $(git rev-parse --short HEAD) for ${tag}."
echo "Build with: npm run dist:win"
