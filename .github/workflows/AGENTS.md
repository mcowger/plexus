# GitHub Actions Notes for AI Agents

## OpenCode workflows

- `opencode-review.yml` is a minimal `pull_request_target` dispatcher. It must never check out or
  inspect pull-request content; it may only pass the PR number and immutable head SHA to the
  default branch's `opencode-review-run.yml` via `workflow_dispatch`.
- `opencode-review-run.yml` fetches fork content as inert data before model secrets enter the
  environment. OpenCode can read only the generated patch and has shell, edit, web, subagent, and
  general repository access denied. Never execute, install, build, or test pull-request files.
- The review response may only be treated as comment text; never execute it or interpolate it into
  shell. Keep both review workflows least-privileged and preserve this trust separation.
- `opencode-assistant.yml` handles trusted collaborator requests from issue and PR comments.
  It needs `contents: write` because explicit requests may change code and push it to a PR branch.
- Both workflows use the repository's existing `LLM_API_KEY`, `LLM_API_HOST`, and
  `LLM_MODEL_ID` configuration through an OpenAI-compatible OpenCode provider.
- Keep OpenCode session sharing disabled so repository context is not published externally.
- Preserve the collaborator and bot filters on the interactive workflow to prevent untrusted
  code-changing runs and comment loops.
- `release.yml` uses OpenCode to generate release notes under `.git/opencode-release/`. Keep its
  tools restricted to reading the release prompt/data and writing the notes file. The workflow must
  reset this scratch directory before generation to prevent stale output, and it must remain under
  `.git/` so the OpenCode action does not automatically commit and push the files.
