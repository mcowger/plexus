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
AGENT="${PASEO_SHIP_AGENT:-generate}"
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
# prints the (cleaned, validated) model output.
generate() {
  local instr="$1"
  local prompt="$2"
  local diff_file="$3"
  local out
  # Use the dedicated `generate` agent (.opencode/agent/generate.md) which is
  # instructed to never preface, confirm, or call tools — it just prints the
  # requested text. validate_single_line rejects anything that slips through.
  out="$(opencode run --dangerously-skip-permissions -m "$MODEL" --agent "$AGENT" --format default "$prompt${instr:+

Project instructions (follow these): $instr}" -f "$diff_file" 2>/dev/null)" || {
    echo "opencode generation failed" >&2
    return 1
  }
  # Strip ANSI escapes, trim leading/trailing blank lines, trim each line.
  printf '%s' "$out" \
    | sed -r 's/\x1b\[[0-9;]*m//g' \
    | sed '/./,$!d' \
    | awk 'NF{p=1} p' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# Reject obvious conversational prefaces from a generation result.
# Prints the cleaned value to stdout if it passes; returns 1 otherwise.
validate_single_line() {
  local value="$1"
  # lowercase first word for checks
  local lc
  lc="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in
    got\ it*|sure*|thanks*|however*|i\ want*|i\ can*|i\'d\ be\ happy*|here\ is*|here\'s*|certainly*|of\ course*|absolutely*|the\ provided*|the\ attached*|unable\ to*)
      return 1
      ;;
  esac
  # must contain no newline (single line)
  [ "$(printf '%s' "$value" | wc -l | tr -d ' ')" -le 1 ] || return 1
  printf '%s' "$value"
}

# ---------------------------------------------------------------------------
log "Staging all changes"
git add -A

STAGED_DIFF="$WORK_DIR/staged.diff"
git diff --cached > "$STAGED_DIFF"

COMMIT_MSG=""
if [ -s "$STAGED_DIFF" ]; then
  log "Generating commit message"
  raw="$(generate \
    "$(read_instr commitMessage)" \
    "You are a commit-message generator. Do not use tools. Do not greet, confirm, or explain. Read the attached git diff of staged changes and write a single Conventional Commits message of the form 'type(scope): summary' describing the final state of the codebase. Print EXACTLY one line: the commit message. No prose, no backticks, no quotes, no markdown." \
    "$STAGED_DIFF")" || { echo "    generation failed" >&2; exit 1; }
  COMMIT_MSG="$(validate_single_line "$raw")" || {
    echo "    rejected generated commit message (conversational/multi-line): $raw" >&2
    exit 1
  }
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
  "You are a pull-request text generator. Do not use tools. Do not greet, confirm, or explain. Read the attached full git diff between the base branch and the current branch and draft a pull request for another engineer. Print EXACTLY:
- Line 1: the PR title, imperative and concise, no quotes, no backticks.
- Line 2: blank.
- Then the PR body in markdown.
Describe the final state of the change. Do not describe the implementation journey, debugging, or discarded approaches. No checklist, no marketing language." \
  "$PR_DIFF")" || { echo "    generation failed" >&2; exit 1; }

PR_TITLE="$(printf '%s\n' "$PR_TEXT" | sed -n '1p')"
PR_BODY="$(printf '%s\n' "$PR_TEXT" | sed '1,2d')"

# Validate the title: reject conversational prefaces; keep to one line.
if ! PR_TITLE="$(validate_single_line "$PR_TITLE")"; then
  echo "    rejected generated PR title (conversational/multi-line): $PR_TITLE" >&2
  exit 1
fi

echo "    title: $PR_TITLE"
[ "${PASEO_SHIP_DRY:-0}" = "1" ] || {
  log "Opening pull request"
  DRAFT_FLAG=""
  [ "${PASEO_SHIP_DRAFT:-0}" = "1" ] && DRAFT_FLAG="--draft"
  gh pr create --title "$PR_TITLE" --body "$PR_BODY" $DRAFT_FLAG --base "$(printf '%s' "$BASE" | sed 's#^origin/##')"
}

log "Done"
