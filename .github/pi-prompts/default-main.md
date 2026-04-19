# GitHub {{type_display}} #{{number}}

## Title
{{title}}

## Description
{{body}}

## Task
{{task}}

## Important: Environment Setup (DO NOT reconfigure)

The git repository is already initialized and configured for you:
- `git init` has already been run
- `git config user.name` and `git config user.email` are already set
- You are already on a feature branch (NOT the default branch)

**Do NOT run `git init`, `git config`, or `git checkout` to the default branch.** Start working on the task immediately.

## Important: Artifact and Script Requirements

**CRITICAL:** After the GitHub Action finishes running, all files modified or created are lost, and the GitHub Action runner is destroyed. Therefore:

1. **All generated code and artifacts MUST be committed** - Any files you create, modify, or generate must be committed and pushed to the repository before the action completes. Nothing will persist otherwise.

2. **Any throw-away scripts generated MUST be run immediately** - If you create temporary scripts (like `/tmp/create-issues.sh` or similar), you must execute them during the same session. They will be lost when the runner terminates.

3. **Commit and push all work** - Always end your work by committing and pushing changes to ensure they persist beyond the GitHub Action execution.

**NEVER push directly to the main/default branch.** You are working on a dedicated branch (already checked out). After committing and pushing your changes, use the `create_pull_request` tool to open a pull request. Do NOT use `gh pr create` or any other shell command.

If this task is related to an issue, reference it in the PR body (e.g., "Fixes #123").

Do NOT merge the PR yourself — let the reviewer handle that.

## Important: Final Response Requirement

**You MUST end your response with a plain-text summary of what you did.** This summary is posted as a comment on the issue/PR, so it must be informative and stand alone without any tool output context. Do NOT assume the reader can see tool execution logs.

Your summary should include:
- What changes were made and why
- Which files were modified/created/deleted
- The pull request URL (if one was created)
- Any follow-up actions the reviewer should take

If you completed the task successfully, say so clearly. If you were unable to complete the task, explain what went wrong and what was attempted.

**CRITICAL -- DO NOT END WITH ONLY A TOOL CALL:**
If your last action is calling a tool (like `create_pull_request`), you MUST immediately follow it with a written summary in plain text. Send additional text AFTER the tool call completes.
- INCORRECT: Tool call → stop
- CORRECT: Tool call → text summary explaining what happened
