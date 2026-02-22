# Disable Cooldown Persistence Report (Ollama Providers)

Last updated: 2026-02-21 UTC
Scope: Documentation and provenance only (no runtime mutations)

## Executive Summary

We verified where the `disable_cooldown` behavior lives, what code was used yesterday, and why behavior did not fully persist after merge/deploy.

- Yesterday's implementation existed in both backend and frontend commits:
  - Backend behavior commit: `c109b3672bd1aa3865014e832015dd08a00e2dcc`
  - Frontend mapping commit: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a`
- Current deployed branch commit is `9917732269dbb6d9bfeb9c10f0aefa1711c28961`.
- In current code, frontend still maps `disable_cooldown`, but backend currently does not enforce it in the active files.
- AI01 test container (`plexus-a2a-test`, port `4101`) was inspected read-only and not modified.

## Constraints and Safety

- User constraint honored: do not modify AI01 test container before backup.
- This pass performed read-only inspection only (`podman inspect`, read-only config checks).
- Secrets policy: all creator-facing docs redact sensitive values as `[REDACTED]`.

## Runtime Evidence (AI01 Test Container)

Read-only baseline captured:

- Container identity:
  - `plexus-a2a-test|localhost/thearchitectit-plexus:a2a-test|running`
- Mounts:
  - `/var/lib/containers/storage/volumes/plexus-a2a-test-data/_data:/app/data`
  - `/home/user001/plexus/plexus.yaml:/app/config/plexus.yaml`

Read-only provider state from mounted host config (`/home/user001/plexus/plexus.yaml`):

- `olamma cloud` -> `chat: https://ollama.com/v1` -> `disable_cooldown: (missing)`
- `plasma` -> `chat: http://100.81.234.111:11434/v1` -> `disable_cooldown: true`
- `UCS03` -> `chat: http://100.99.118.48:11434/v1` -> `disable_cooldown: true`

## Where It Is In Code (Current Head)

Current head: `9917732` on `merge/for-main` (tracks `origin/main`).

### Frontend: present

`packages/frontend/src/lib/api.ts` contains `disableCooldown` and YAML mapping:

- Provider type field: `disableCooldown?: boolean;`
- Raw config field: `disable_cooldown?: boolean;`
- Read mapping: `disableCooldown: val.disable_cooldown === true`
- Write mapping:
  - `disable_cooldown: p.disableCooldown === true`
  - `disable_cooldown: provider.disableCooldown === true`

### Backend: currently not enforced

`packages/backend/src/config.ts` current `ProviderConfigSchema` does not include `disable_cooldown`.

`packages/backend/src/services/dispatcher.ts` current error path still calls:

- `cooldownManager.markProviderFailure(route.provider, route.model, cooldownDuration);`

`packages/backend/src/services/cooldown-manager.ts` current filtering path:

- `filterHealthyTargets()` checks only cooldown health state, with no `disable_cooldown` bypass.

`packages/backend/src/services/router.ts` currently filters targets by cooldown state via:

- `CooldownManager.getInstance().filterHealthyTargets(enabledTargets)`

## What We Used Yesterday (Provenance)

### Backend commit used yesterday

Commit: `c109b3672bd1aa3865014e832015dd08a00e2dcc`
Message: `Add A2A backend protocol routes, ownership guards, and hardening`

This commit added:

- Backend provider schema support:
  - `disable_cooldown: z.boolean().optional().default(false),`
- Dispatcher bypass helper:
  - `markProviderFailure(route, durationMs)`
  - early return when `route.config.disable_cooldown === true`
  - log: `Cooldown disabled for provider ... skipping failure cooldown`
- Replaced direct cooldown calls with helper calls.

### Frontend commit used yesterday

Commit: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a`
Message: `Replace Metrics route with A2A Console and add Model Pulse`

This commit added/kept:

- `disableCooldown?: boolean` in frontend Provider interface
- `disable_cooldown?: boolean` in frontend raw config type
- read/write mappings between UI model and YAML.

### Branch containment verification

`c109b367...` is contained in:

- `feature/a2a-protocol-console`
- `main`

## Why Persistence Failed (Observed)

Observed state indicates partial persistence:

- Frontend mapping persisted.
- Active backend enforcement is absent in current files.

Operational impact:

- Setting `disable_cooldown: true` in YAML may still appear in config/UI pipeline,
- but backend cooldown behavior can continue to apply if enforcement logic is not present in active backend code paths.

## Backup-First Protocol (Before Any Runtime Changes)

Use this protocol before touching `plexus-a2a-test` or production containers.

```bash
# 1) Backup host config file (timestamped)
ssh user001@100.96.49.42 'mkdir -p /home/user001/plexus/backup && cp /home/user001/plexus/plexus.yaml /home/user001/plexus/backup/plexus.yaml.$(date +%Y%m%d-%H%M%S)'

# 2) Verify backup exists
ssh user001@100.96.49.42 'ls -lt /home/user001/plexus/backup/plexus.yaml.* | head -1'

# 3) Capture checksum for rollback integrity
ssh user001@100.96.49.42 'sha256sum /home/user001/plexus/backup/plexus.yaml.* | head -1'

# 4) Capture current test container metadata
ssh user001@100.96.49.42 "sudo podman inspect plexus-a2a-test --format '{{.Name}}|{{.ImageName}}|{{.State.Status}}|{{range .Mounts}}{{.Source}}:{{.Destination}};{{end}}'"
```

Rule: no test-container changes before backup evidence exists.

## Persistence Guardrails (Future Merge/Deploy)

Use these checks after each merge and before each deploy:

```bash
# Frontend mapping exists
grep -n "disableCooldown\|disable_cooldown" packages/frontend/src/lib/api.ts

# Backend schema includes disable_cooldown (should exist for full persistence)
grep -n "disable_cooldown" packages/backend/src/config.ts

# Backend enforcement path includes bypass check (should exist)
grep -n "route.config.disable_cooldown\|Cooldown disabled for provider\|markProviderFailure(route" packages/backend/src/services/dispatcher.ts

# Cooldown path still active and known
grep -n "filterHealthyTargets" packages/backend/src/services/router.ts packages/backend/src/services/cooldown-manager.ts
```

If frontend and backend checks diverge, block deployment and reconcile before release.

## 5-Minute Verification Checklist

1. Confirm current commit and branch:
   - `git rev-parse --short HEAD && git status --short --branch`
2. Confirm historical provenance:
   - `git show --no-patch c109b3672bd1aa3865014e832015dd08a00e2dcc`
   - `git show --no-patch f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a`
3. Confirm runtime test container mapping (read-only):
   - `ssh user001@100.96.49.42 "sudo podman inspect plexus-a2a-test --format '{{.Name}}|{{range .Mounts}}{{.Source}}:{{.Destination}};{{end}}'"`
4. Confirm provider flags in mounted config (read-only):
   - inspect `ollama`/`:11434` providers for `disable_cooldown` consistency.

## Notes

- No runtime mutation was performed in this documentation pass.
- Full code excerpts are provided in `docs/disable-cooldown-code-appendix.md`.
