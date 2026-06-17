#!/usr/bin/env bash
# "ship": stage, generate a commit message, commit, push to origin,
# and open a pull request — with the commit message and PR title/body
# authored by opencode using the project's paseo.json metadataGeneration
# instructions.
#
# Wired up as the `ship` paseo script in paseo.json:
#   "scripts": { "ship": { "command": "bash scripts/ship.sh" } }
#
# Env knobs:
#   PASEO_SHIP_MODEL   opencode model id (default: plexus/small-fast)
#   PASEO_SHIP_BASE    base ref to diff against for the PR (default: origin/HEAD)
#   PASEO_SHIP_DRAFT   "1" to open the PR as a draft
#   PASEO_SHIP_DRY     "1" to print what would happen without committing/pushing/pr'ing

set -euo pipefail

MODEL="${PASEO_SHIP_MODEL:-plexus/small-fast}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || { echo "Not in a git repo" >&2; exit 1; })"
cd "$REPO_ROOT"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }

# Read the per-project metadata generation instructions from paseo.json.
# These are the same instructions paseo's own metadata pipeline uses.
read_instr() {
  local key="$1"
  if [ -f "$REPO_ROOT/paseo.json" ]; then
    jq -r --arg k "$key" '.metadataGeneration[$k].instructions // empty' "$REPO_ROOT/paseo.json"
  fi
}

# generate <instruction_text> <prompt_file> <diff_file>
# Runs opencode with fixed instruction text + a diff attached as a file,
# prints the (cleaned) model output.
generate() {
  local instr="$1"
  local prompt="$2"
  local diff_file="$3"
  local out
  out="$(opencode run -m "$MODEL" --format default "$prompt${instr:+

Project instructions (follow these): $instr}" -f "$diff_file" 2>/dev/null)" || {
    echo "opencode generation failed" >&2
    return 1
  }
  # strip ANSI + leading/trailing blank lines
  printf '%s' "$out" | sed -r 's/\x1b\[[0-9;]*m//g' | sed '/./,$!d' | awk 'NF{p=1} p' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# ---------------------------------------------------------------------------
log "Staging all changes"
git add -A

STAGED_DIFF="$WORK_DIR/staged.diff"
git diff --cached > "$STAGED_DIFF"

COMMIT_MSG=""
if [ -s "$STAGED_DIFF" ]; then
  log "Generating commit message"
  COMMIT_MSG="$(generate \
    "$(read_instr commitMessage)" \
    "The attached file is the git diff of staged changes. Write a single Conventional Commits message (format: type(scope): summary) describing the final state of the codebase. Output ONLY the commit message, one line, no backticks, no quotes, no explanation, no tools." \
    "$STAGED_DIFF")"
  echo "    commit: $COMMIT_MSG"
  [ "${PASEO_SHIP_DRY:-0}" = "1" ] || git commit -m "$COMMIT_MSG"
else
  echo "    nothing staged to commit; skipping commit"
fi

# ---------------------------------------------------------------------------
log "Pushing current branch to origin"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "${PASEO_SHIP_DRY:-0}" = "1" ] || git push -u origin HEAD

# ---------------------------------------------------------------------------
log "Generating pull request title and body"
BASE="${PASEO_SHIP_BASE:-origin/HEAD}"
# Show everything that differs from the base branch: committed divergence
# (three-dot) plus any uncommitted changes, so the PR text reflects the
# real end state even if the commit hasn't landed yet.
PR_DIFF="$WORK_DIR/pr.diff"
git diff "${BASE}...HEAD" > "$PR_DIFF"
git diff HEAD >> "$PR_DIFF"
if [ ! -s "$PR_DIFF" ]; then
  # fall back to staged-only if base ref has nothing to diff against
  git diff --cached >> "$PR_DIFF"
fi

PR_TEXT="$(generate \
  "$(read_instr pullRequest)" \
  "The attached file is the full git diff between the base branch and the current branch. Draft a pull request for another engineer. Output EXACTLY two sections:
- Line 1: the PR title (imperative, concise, no quotes).
- A blank line.
- Then the PR body in markdown.
Describe the final state of the change. Do not describe the implementation journey, debugging, or discarded approaches. No checklist, no marketing language. No backticks around the title. No tools." \
  "$PR_DIFF")"

PR_TITLE="$(printf '%s\n' "$PR_TEXT" | sed -n '1p')"
PR_BODY="$(printf '%s\n' "$PR_TEXT" | sed '1,2d')"

echo "    title: $PR_TITLE"
[ "${PASEO_SHIP_DRY:-0}" = "1" ] || {
  log "Opening pull request"
  DRAFT_FLAG=""
  [ "${PASEO_SHIP_DRAFT:-0}" = "1" ] && DRAFT_FLAG="--draft"
  gh pr create --title "$PR_TITLE" --body "$PR_BODY" $DRAFT_FLAG --base "$(printf '%s' "$BASE" | sed 's#^origin/##')"
}

log "Done"
