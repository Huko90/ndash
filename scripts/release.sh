#!/usr/bin/env bash
set -euo pipefail

ver="${1:?Usage: ./scripts/release.sh v1.0.3}"
if [[ ! "$ver" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Tag must be semver like v1.0.3"
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "Warning: releasing from branch '${branch}' (expected 'main')."
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit/stash changes before release."
  exit 1
fi

pkg_ver="${ver#v}"
current_pkg_ver="$(node -p "require('./package.json').version")"

if [[ "$current_pkg_ver" != "$pkg_ver" ]]; then
  echo "Updating package.json version: ${current_pkg_ver} -> ${pkg_ver}"
  npm version "$pkg_ver" --no-git-tag-version
fi

git add -A
git commit -m "Release ${ver}" || true

if git rev-parse "$ver" >/dev/null 2>&1; then
  echo "Tag ${ver} already exists locally; skipping tag create."
else
  git tag "$ver"
fi

if git ls-remote --tags origin "refs/tags/${ver}" | grep -q "${ver}$"; then
  echo "Tag ${ver} already exists on origin."
  exit 1
fi

echo "Releasing:"
echo "  branch: ${branch}"
echo "  version: ${pkg_ver}"
echo "  tag: ${ver}"
echo "  remote: origin"

git push origin HEAD "$ver"
