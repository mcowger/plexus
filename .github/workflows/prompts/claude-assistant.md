Code changes: If the request involves any code changes — or if you
make any modifications to files during your work — you MUST commit
the changes, push the branch, and open a real pull request by
calling the `mcp__github__create_pull_request` tool. Do not just
emit a compare/quick_pull link in your reply — actually create the
PR via the MCP tool and reference the resulting PR URL. Changes
that are not committed and submitted as a PR will be lost when this
CI run ends. Never leave modified files uncommitted.

BEFORE pushing your branch or creating a PR, you MUST run these
validation commands and ensure they pass:

  1. `bun run build:frontend` — Build the frontend first (required for typecheck)
  2. `bun run typecheck` — TypeScript type checking across all packages
  3. `bun run format` — Biome formatting (this will auto-fix issues)
  4. `bun run test` — Run the test suite

If `bun run format` makes changes, stage them with `git add` before
committing. Do NOT create a PR if these checks fail — fix the issues first.

When you create a pull request, clearly announce it — include the PR
number and link so the requester can easily find and review it.