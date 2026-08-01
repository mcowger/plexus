#!/usr/bin/env bash
# Advisory PR-Agent review of the diff being pushed (plain-diff mode, no PR URL
# or GitHub credentials involved). This hook is strictly optimistic: every
# failure path prints a warning and exits 0 so it can NEVER block a push.
#
# stdin (forwarded by Lefthook via `use_stdin: true`) carries git's pre-push
# refs, one line per pushed ref:
#   <local ref> <local sha> <remote ref> <remote sha>
#
# Configuration (environment, never committed):
#   OPENAI__KEY       LLM provider key (unless CONFIG__MODEL points at a local model)
#   OPENAI__API_BASE  optional LLM endpoint override
#   CONFIG__MODEL     model override (e.g. a local Ollama model)

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 0

VENV_PY="$REPO_ROOT/.venv/bin/python"
ZERO_SHA="0000000000000000000000000000000000000000"

info() { printf '[pre-push][pr-agent] %s\n' "$*" >&2; }
warn() { printf '[pre-push][pr-agent] WARNING: %s\n' "$*" >&2; }

# --- Preflight: PR-Agent installed? ------------------------------------------
if [ ! -x "$VENV_PY" ]; then
	warn "PR-Agent virtualenv not found at .venv/ - skipping advisory review."
	warn "Install it with:  mise install && mise run pr-agent:setup"
	exit 0
fi

if ! "$VENV_PY" -m pip show pr-agent >/dev/null 2>&1; then
	warn "pr-agent is not installed in .venv - skipping advisory review."
	warn "Re-run:  mise run pr-agent:setup"
	exit 0
fi

# --- Preflight: configuration present? ---------------------------------------
if [ ! -f "$REPO_ROOT/.pr_agent.toml" ]; then
	warn ".pr_agent.toml not found - skipping advisory review."
	warn "PR-Agent plain-diff mode needs .pr_agent.toml plus an LLM key"
	warn "(OPENAI__KEY / OPENAI__API_BASE / CONFIG__MODEL). See CONTRIBUTING.md."
	exit 0
fi

# --- Review each ref git is pushing -------------------------------------------
# Hook mode: ref lines come from git's pre-push stdin (forwarded by Lefthook).
# Manual mode (`--manual [BASE]`, i.e. `bun run review [BASE]`): synthesize one
# ref line diffing BASE (default: origin/HEAD) against HEAD.
{
	if [ "${1:-}" = "--manual" ]; then
		MANUAL_BASE="${2:-origin/HEAD}"
		MANUAL_LOCAL="$(git rev-parse HEAD 2>/dev/null)"
		MANUAL_REMOTE="$(git rev-parse "$MANUAL_BASE" 2>/dev/null)"
		if [ -z "$MANUAL_LOCAL" ] || [ -z "$MANUAL_REMOTE" ]; then
			warn "cannot resolve HEAD or base '$MANUAL_BASE' - nothing to review."
			exit 0
		fi
		info "manual mode: reviewing $MANUAL_BASE...HEAD"
		printf 'HEAD %s %s %s\n' "$MANUAL_LOCAL" "$MANUAL_BASE" "$MANUAL_REMOTE"
	else
		cat
	fi
} | while read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA; do
	[ -z "$LOCAL_SHA" ] && continue

	# Branch deletion: local side is the zero SHA, nothing to review.
	if [ "$LOCAL_SHA" = "$ZERO_SHA" ]; then
		continue
	fi

	if [ "$REMOTE_SHA" = "$ZERO_SHA" ]; then
		# New remote branch: no upstream commit to diff against. Fall back to
		# the merge-base with the remote default branch; skip if unknown.
		BASE="$(git merge-base "$LOCAL_SHA" origin/HEAD 2>/dev/null)"
		if [ -z "$BASE" ]; then
			warn "new remote branch $REMOTE_REF and no origin/HEAD merge-base found -"
			warn "skipping advisory review for $LOCAL_REF."
			continue
		fi
		warn "new remote branch $REMOTE_REF - reviewing against merge-base with origin/HEAD."
		DIFF_SPEC="$BASE..$LOCAL_SHA"
	else
		# Three-dot: diff from the merge-base, i.e. only what this push adds.
		DIFF_SPEC="$REMOTE_SHA...$LOCAL_SHA"
	fi

	if ! DIFF="$(git diff "$DIFF_SPEC" 2>/dev/null)"; then
		warn "could not compute diff ($DIFF_SPEC) - remote objects missing locally?"
		warn "Skipping advisory review for $LOCAL_REF."
		continue
	fi

	if [ -z "${DIFF//[[:space:]]/}" ]; then
		info "empty diff for $LOCAL_REF - nothing to review."
		continue
	fi

	info "--- Advisory PR-Agent review (non-blocking): $LOCAL_REF -> $REMOTE_REF ---"
	OUTPUT_FILE="$(mktemp -t pr-agent-review.XXXXXX)"
	if printf '%s\n' "$DIFF" | "$VENV_PY" -m pr_agent.cli --stdin review >"$OUTPUT_FILE" 2>&1; then
		sed 's/^/[pr-agent] /' "$OUTPUT_FILE"
	else
		warn "PR-Agent review failed (missing LLM key, unreachable API, or other error)."
		warn "Configure OPENAI__KEY / OPENAI__API_BASE / CONFIG__MODEL - see"
		warn "CONTRIBUTING.md ('Optional: advisory PR-Agent pre-push review')."
		warn "Reproduce manually with:  git diff ... | .venv/bin/python -m pr_agent.cli --stdin review"
	fi
	rm -f "$OUTPUT_FILE"
done

# Absolutely never block the push.
exit 0
