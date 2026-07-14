# GitHub Actions Notes for AI Agents

## `workflows: write` Permission Issue

### Problem
Adding `workflows: write` to the workflow permissions block causes the workflow to **fail validation** and prevents it from triggering on `issue_comment` events.

### Error
```
Invalid workflow file: .github/workflows/pi-assistant.yml#L1
(Line: 18, Col: 7): Unexpected value 'workflows'
```

### Root Cause
The `workflows` permission is **only valid at the job level**, not at the workflow level. However, even when placed correctly at the job level, it can cause issues with workflow triggering.

### What We Tried

1. **Job-level permissions** - Added to the `pi-agent` job:
   ```yaml
   jobs:
     pi-agent:
       permissions:
         contents: write
         issues: write
         pull-requests: write
         workflows: write  # Invalid at job level for this use case
   ```

2. **Workflow-level permissions** - Moved to top level:
   ```yaml
   permissions:
     contents: write
     issues: write
     pull-requests: write
     workflows: write  # Invalid at workflow level
   ```

Both approaches caused the workflow to fail validation and not trigger.

### Impact
Without `workflows: write`, the Pi Assistant action **cannot create branches or pull requests** when the repository contains workflow files. The action will receive:
```
refusing to allow a GitHub App to create or update workflow '.github/workflows/pi-assistant.yml' without 'workflows' permission
```

### Current Workaround
The workflow runs without `workflows: write`, meaning:
- The agent can respond to comments
- The agent can read files and provide analysis
- The agent **cannot** push branches or create PRs

### Future Solutions
To enable branch/PR creation, consider:
1. Using a GitHub App with explicit `workflows` permission instead of `GITHUB_TOKEN`
2. Creating a separate workflow that handles PR creation with elevated permissions
3. Moving the Pi Assistant to a repository without workflow files

---

## Workflow Design Patterns

### Communication Protocol
The Pi Assistant uses the following guidance for consistent interaction:

1. **Single progress comment**: Post one comment with acknowledgment + checklist, update via `update_issue_comment`
2. **Checkbox syntax**: Use `- [ ]` / `- [x]` format, never strikethrough
3. **PR creation**: When code changes are made, create a branch/PR and update the progress comment with the PR link

### Permissions Required
- `contents: write` - for reading repo contents
- `issues: write` - for posting/updating comments
- `pull-requests: write` - for creating PRs (if `workflows` permission issue is resolved)
