#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <github-repo-url> [branch]" >&2
  exit 1
fi

repo_url="$1"
branch="${2:-main}"

if git remote get-url backup >/dev/null 2>&1; then
  git remote set-url backup "$repo_url"
else
  git remote add backup "$repo_url"
fi

git push -u backup "$branch"
