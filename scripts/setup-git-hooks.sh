#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
hooks_dir="$repo_root/.githooks"

git -C "$repo_root" config core.hooksPath .githooks
chmod +x "$hooks_dir/pre-commit"

echo "Configured git hooks path to .githooks"
echo "Pre-commit hook is ready: $hooks_dir/pre-commit"
