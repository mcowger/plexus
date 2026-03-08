# Stacked PRs for RequestShaper Feature

## Important: Stacked PR Workflow Required

When submitting PRs for the low-RPM RequestShaper feature, they **MUST** be submitted as **STACKED PRs**.

### What are Stacked PRs?

Each PR in the stack targets the previous PR's branch, creating a dependency chain:

```
main
  ↓
PR #97 (config-shaper-env) ← targets main
  ↓
PR #98 (retry-after-parsing) ← targets feat/config-shaper-env
  ↓
PR #3 (shaper-schema) ← targets feat/retry-after-parsing
  ↓
PR #4a (types) ← targets feat/shaper-schema
  ↓
PR #4b (lifecycle) ← targets feat/request-shaper-types
  ↓
...
```

### How to Create Stacked PRs

Using GitHub CLI:

```bash
# PR #3: Database schema
git checkout feat/shaper-schema
git push origin feat/shaper-schema
gh pr create --repo mcowger/plexus \
  --title "feat: add RequestShaper database schema" \
  --head TheArchitectit:feat/shaper-schema \
  --base feat/retry-after-parsing

# PR #4a: Types (after PR #3 is submitted)
git checkout feat/request-shaper-types
git push origin feat/request-shaper-types
gh pr create --repo mcowger/plexus \
  --title "feat: add RequestShaper types" \
  --head TheArchitectit:feat/request-shaper-types \
  --base feat/shaper-schema
```

### Current PR Stack (11 PRs)

1. **PR #97**: `feat/config-shaper-env` → targets `main` (DRAFT)
2. **PR #98**: `feat/retry-after-parsing` → targets `feat/config-shaper-env` (DRAFT)
3. **PR #3**: `feat/shaper-schema` → targets `feat/retry-after-parsing` (53 lines)
4. **PR #4a**: `feat/request-shaper-types` → targets `feat/shaper-schema` (162 lines)
5. **PR #4b**: `feat/request-shaper-lifecycle` → targets `feat/request-shaper-types` (191 lines)
6. **PR #4c**: `feat/request-shaper-status` → targets `feat/request-shaper-lifecycle` (171 lines)
7. **PR #4d**: `feat/request-shaper-queue` → targets `feat/request-shaper-status` (112 lines)
8. **PR #4e**: `feat/request-shaper-impl` → targets `feat/request-shaper-queue` (434 lines)
9. **PR #5**: `feat/dispatcher-shaper-integration` → targets `feat/request-shaper-impl` (119 lines)
10. **PR #6a**: `feat/management-rate-limits` → targets `feat/dispatcher-shaper-integration` (254 lines)
11. **PR #6b**: `feat/management-rate-limits-tests` → targets `feat/management-rate-limits` (451 lines)

### Why Stacked PRs?

1. **Incremental Review**: Each PR is small (<500 lines) and focused
2. **Clear Dependencies**: Each PR builds on the previous one
3. **Easier Testing**: Can test each component independently
4. **Safe Rollback**: Can revert individual PRs without affecting the whole stack

### Requirements

- All PRs must be **under 500 lines**
- Each PR must have a **clear, descriptive title**
- PRs must be submitted **in order** (don't skip ahead)
- Wait for previous PR approval before merging (or maintain the stack)

### GitHub CLI Setup

Ensure you have GitHub CLI installed and authenticated:

```bash
# Install gh CLI (if not already installed)
# See: https://github.com/cli/cli#installation

# Authenticate
git auth login

# Verify authentication
git auth status
```