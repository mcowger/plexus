#!/usr/bin/env bash
set -euo pipefail

if ! command -v ctags >/dev/null 2>&1; then
  exit 0
fi

bun run generate:repomap

if git diff --quiet HEAD -- .repomap.txt; then
  exit 0
fi

git add .repomap.txt
printf '%s\n' '[pre-push] .repomap.txt was updated and staged. Commit it, then push again.' >&2
exit 1
