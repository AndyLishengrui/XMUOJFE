#!/usr/bin/env bash

set -euo pipefail

owner="${1:-AndyLishengrui}"
repo="${2:-xmuojFE}"
branch="${3:-main}"
visibility="${4:-public}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required to create the GitHub repository automatically" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

repo_url="https://github.com/${owner}/${repo}.git"

if gh repo view "${owner}/${repo}" >/dev/null 2>&1; then
  echo "Repository already exists: ${owner}/${repo}"
else
  gh repo create "${owner}/${repo}" --"${visibility}" --source=. --remote=backup --push
  exit 0
fi

if git remote get-url backup >/dev/null 2>&1; then
  git remote set-url backup "$repo_url"
else
  git remote add backup "$repo_url"
fi

git push -u backup "$branch"
