# Upstream Sync Operations Runbook

Operational procedures for syncing from upstream mcowger/plexus and deploying to AI01.

---

## Prerequisites

Before running any sync or deploy operations, verify these conditions are met.

### Environment Requirements

| Requirement | Command to Verify | Expected Result |
|-------------|-------------------|-----------------|
| SSH access to AI01 | `ssh -o ConnectTimeout=5 user001@100.96.49.42 "echo OK"` | `OK` |
| Git repository clean | `git status --porcelain` | Empty output |
| Local repository is git | `git -C . rev-parse --git-dir` | Path to `.git` |
| Backup directory writable | `test -w "$HOME/.plexus-backups" && echo OK` | `OK` |
| Required commands | `which ssh scp tar date git` | All paths present |

### Secret Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `PLEXUS_BACKUP_ROOT` | `${HOME}/.plexus-backups` | Hidden backup directory outside git |
| `AI01_SSH` | `user001@100.96.49.42` | SSH connection string |
| `AI01_DIR` | `~/plexus` | Remote Plexus directory |

---

## Command Matrix

### 1. update-from-upstream.sh

Sync local repository with upstream mcowger/plexus, preserving local configuration.

| Command | Purpose |
|---------|---------|
| `./scripts/update-from-upstream.sh` | Execute sync with backups and manifest preservation |
| `./scripts/update-from-upstream.sh --dry-run` | Preview changes without mutations |

**What it does:**
1. Acquires exclusive lock (prevents concurrent runs)
2. Validates git state (clean working tree)
3. Backs up local preserved files: `.env`, `plexus.yaml`, `start-plexus.sh`, `stop-plexus.sh`
4. Generates pre-merge checksum manifest
5. Backs up AI01 configuration via SSH
6. Fetches and merges upstream changes
7. Restores local preserved files from backup
8. Validates restored files match checksums
9. Validates DATABASE_URL invariant

**Exit codes:**
- `0`: Success
- `1`: Git/validation error
- `2`: Merge conflict (backup is safe)
- `3`: Lock acquisition failed
- `4`: Restore validation failed
- `5`: DATABASE_URL invariant breach

**Evidence output:**
```
$PLEXUS_BACKUP_ROOT/
└── YYYYMMDD-HHMMSS/
    ├── local/
    │   ├── .env
    │   ├── plexus.yaml
    │   ├── start-plexus.sh
    │   ├── stop-plexus.sh
    │   ├── restored-files.list
    │   └── preserve-manifest.sha256
    ├── ai01/
    │   ├── config-files.tgz
    │   ├── database-url.txt
    │   └── checksums.txt
    └── summary.txt
```

---

### 2. deploy-to-ai01.sh

Deploy runtime artifacts to AI01 with backup-before-deploy gate.

| Command | Purpose |
|---------|---------|
| `./scripts/deploy-to-ai01.sh` | Execute deployment with remote backup |
| `./scripts/deploy-to-ai01.sh --dry-run` | Preview deployment actions |

**What it does:**
1. Acquires exclusive lock
2. Validates local runtime files exist
3. Creates timestamped backup on AI01 (`$AI01_DIR/.plexus-backups/`)
4. Verifies backup integrity
5. Transfers files to AI01 (rsync preferred, scp fallback)
6. Executes `./stop-plexus.sh && ./start-plexus.sh` on AI01

**Files deployed:** `.env`, `plexus.yaml`, `start-plexus.sh`, `stop-plexus.sh`

**Exit codes:**
- `0`: Success
- `1`: Validation, backup, transfer, or restart failure
- `3`: Lock acquisition failed

---

### 3. ai01-smoke-test.sh

Post-deploy health validation for Plexus on AI01.

| Command | Purpose |
|---------|---------|
| `./scripts/ai01-smoke-test.sh` | Run smoke tests |
| `./scripts/ai01-smoke-test.sh --verbose` | Run with detailed output |

**Checks performed:**

| Check | Validation |
|-------|------------|
| Container Running | Podman container `plexus` exists and is up |
| Models Endpoint | HTTP 200 from `localhost:4001/v1/models` |
| JSON Structure | Response contains `object=list` and `data` array |
| DATABASE_URL Env | Container has `DATABASE_URL` with `postgresql://` prefix |
| Log Scan | Last 50 lines contain no critical error patterns |

**Critical error patterns:** `Migration failed`, `Failed to initialize database`, `panic`, `FATAL`, `ERROR.*database`, `Connection refused`, `ECONNREFUSED`, `unhandled.*exception`, `TypeError.*cannot read`, `SyntaxError`

**Exit codes:**
- `0`: All checks passed
- `1`: One or more checks failed

---

### 4. ai01-rollback.sh

Restore runtime files from backup and restart Plexus.

| Command | Purpose |
|---------|---------|
| `./scripts/ai01-rollback.sh` | Rollback using latest valid backup |
| `./scripts/ai01-rollback.sh --backup-id YYYYMMDD-HHMMSS` | Rollback to specific backup |
| `./scripts/ai01-rollback.sh --backup-path /path/to/backup.tar.gz` | Rollback from explicit path |
| `./scripts/ai01-rollback.sh --dry-run` | Preview rollback actions |

**What it does:**
1. Resolves backup path (latest, by ID, or explicit)
2. Validates backup integrity
3. Transfers backup to AI01 temp location
4. Creates pre-rollback backup on AI01
5. Extracts rollback archive
6. Sets permissions (`.env` 600, scripts executable)
7. Executes `./start-plexus.sh`
8. Runs smoke test

**Exit codes:**
- `0`: Success (smoke test passed)
- `1`: Backup not found, validation failed, transfer failed, or smoke test failed
- `3`: Lock acquisition failed

---

### 5. run-upstream-sync-and-deploy.sh

Orchestrator for end-to-end gated flow: sync, deploy, smoke, with automatic rollback on failure.

| Command | Purpose |
|---------|---------|
| `./scripts/run-upstream-sync-and-deploy.sh` | Full pipeline (sync → deploy → smoke) |
| `./scripts/run-upstream-sync-and-deploy.sh --dry-run` | Preview all stages |
| `./scripts/run-upstream-sync-and-deploy.sh --skip-sync` | Deploy and smoke only |
| `./scripts/run-upstream-sync-and-deploy.sh --skip-deploy` | Sync and smoke only |
| `./scripts/run-upstream-sync-and-deploy.sh --skip-smoke` | Sync and deploy only |
| `./scripts/run-upstream-sync-and-deploy.sh --no-rollback` | Disable automatic rollback on failure |

**Stage flow:**

```
sync -> deploy -> smoke
  |       |        |
  v       v        v
FAILED  FAILED   FAILED
  |       |        |
  +-------+--------+
          |
          v
    invoke rollback
```

**Exit codes:**
- `0`: All requested stages completed successfully
- `1`: One or more stages failed (rollback may have been attempted)
- `2`: Configuration or preflight error

---

## Operational Procedures

### Dry-Run Workflow (Recommended First Step)

Always run dry-run before live execution to preview changes.

```bash
# Dry run the full pipeline
./scripts/run-upstream-sync-and-deploy.sh --dry-run

# Review output for expected actions
# Look for: backup paths, merge preview, file transfers
```

### Standard Live Run

Execute full pipeline after dry-run validation.

```bash
# 1. Pre-check: verify clean working tree
git status --porcelain

# 2. Run full pipeline
./scripts/run-upstream-sync-and-deploy.sh

# 3. Verify success in summary output
```

### Deploy-Only Workflow

Use when local changes are ready but no upstream sync is needed.

```bash
# Deploy current local state to AI01
./scripts/run-upstream-sync-and-deploy.sh --skip-sync
```

### Evidence and Logging

Scripts produce output to stdout/stderr. Capture logs manually:

```bash
# Capture full pipeline output with timestamp
./scripts/run-upstream-sync-and-deploy.sh 2>&1 | tee ~/.plexus-backups/run-$(date +%Y%m%d-%H%M%S).log
```

**Backup locations by script:**
- `update-from-upstream.sh`: Creates `$PLEXUS_BACKUP_ROOT/YYYYMMDD-HHMMSS/` with preserved files and manifests
- `deploy-to-ai01.sh`: Creates `$PLEXUS_BACKUP_ROOT/deploy-YYYYMMDD-HHMMSS/` for local logs; remote backup at `$AI01_DIR/.plexus-backups/`
- `ai01-smoke-test.sh`: Outputs to stdout (use `tee` to capture)
- `ai01-rollback.sh`: Outputs to stdout (use `tee` to capture)
---

## Failure Matrix / Playbook

### Scenario: Merge Conflict During Sync

**Symptoms:**
```
[ERROR] Merge conflict detected. Aborting merge.
[ERROR] Backups are safe in: /home/user/.plexus-backups/YYYYMMDD-HHMMSS
```

**Response:**

```bash
# 1. Review conflict report
jq . /home/user/.plexus-backups/YYYYMMDD-HHMMSS/conflict-report.json

# 2. Abort the merge (script already did this)
git merge --abort

# 3. Resolve manually or skip conflicting changes
# Edit files to resolve conflicts

# 4. Commit resolution
git add <resolved-files>
git commit -m "Resolve upstream merge conflicts"

# 5. Re-run sync
./scripts/update-from-upstream.sh
```

---

### Scenario: Deploy Backup Failure

**Symptoms:**
```
[ERROR] DEPLOY ABORTED: Remote backup failed
```

**Response:**

```bash
# 1. Verify SSH connectivity
ssh user001@100.96.49.42 "echo OK"

# 2. Check remote backup directory exists and is writable
ssh user001@100.96.49.42 "ls -la ~/plexus/.plexus-backups/"

# 3. Create directory if missing
ssh user001@100.96.49.42 "mkdir -p ~/plexus/.plexus-backups"

# 4. Re-run deploy
./scripts/deploy-to-ai01.sh
```

---

### Scenario: Smoke Test Failure

**Symptoms:**
```
[FAIL] Container Running: Container does not exist
[FAIL] Models Endpoint: HTTP 502 (expected 200)
RESULT: SOME CHECKS FAILED
```

**Response:**

```bash
# 1. Run with verbose flag for details
./scripts/ai01-smoke-test.sh --verbose

# 2. Check container status on AI01
ssh user001@100.96.49.42 "sudo podman ps -a | grep plexus"

# 3. View recent logs
ssh user001@100.96.49.42 "sudo podman logs --tail=100 plexus"

# 4. If rollback available, execute rollback
./scripts/ai01-rollback.sh

# 5. Verify rollback with smoke test
./scripts/ai01-smoke-test.sh
```

---

### Scenario: Provider Save Fails with Read-Only Config Error

**Symptoms:**
```
Failed to save provider: Error: EROFS: read-only file system, open '/app/config/plexus.yaml'
```

**Root Cause:**
`start-plexus.sh` mounts a single file to `/app/config/plexus.yaml`. Provider save uses an atomic rewrite and needs write access to the containing directory.

**Response:**

```bash
# 1. Verify mount pattern in start script
ssh user001@100.96.49.42 "grep -n '/app/config' ~/plexus/start-plexus.sh"

# 2. Ensure directory bind mount is used (not file bind mount)
# Expected run flag form:
#   -v "$(pwd):/app/config"

# 3. Restart Plexus
ssh user001@100.96.49.42 "cd ~/plexus && ./stop-plexus.sh && ./start-plexus.sh"

# 4. Verify atomic config rewrite works
ssh user001@100.96.49.42 "sudo podman exec plexus sh -lc 'set -e; cp /app/config/plexus.yaml /app/config/.plexus-write-check; mv /app/config/.plexus-write-check /app/config/plexus.yaml'"

# 5. Re-run smoke test
EXPECTED_APP_VERSION_PREFIX=v0.16.9 ./scripts/ai01-smoke-test.sh --verbose
```

---

### Scenario: Graphs/Logs Empty While Service Is Running

**Symptoms:**
```
Dashboard charts stop updating
Logs page appears empty or stale
container logs show: request_usage_pkey
```

**Root Cause:**
Metrics and log views read from `request_usage` in PostgreSQL. If `request_usage_id_seq` lags behind imported IDs, inserts fail with primary-key collisions and new usage records do not persist.

**Response:**

```bash
# 1. Confirm service is on PostgreSQL
ssh user001@100.96.49.42 "sudo podman exec plexus sh -lc 'echo $DATABASE_URL'"

# 2. Confirm sequence drift
ssh user001@100.96.49.42 "sudo podman exec plexus-postgres psql -U plexus -d plexus -c \"SELECT last_value, is_called FROM request_usage_id_seq; SELECT MAX(id) FROM request_usage;\""

# 3. Repair sequence to next available id
ssh user001@100.96.49.42 "sudo podman exec plexus-postgres psql -U plexus -d plexus -c \"SELECT setval('request_usage_id_seq', (SELECT COALESCE(MAX(id),0)+1 FROM request_usage), false);\""

# 4. Verify sequence and check recent errors clear
ssh user001@100.96.49.42 "sudo podman exec plexus-postgres psql -U plexus -d plexus -c \"SELECT last_value, is_called FROM request_usage_id_seq;\""
ssh user001@100.96.49.42 "sudo podman logs --since 30s plexus | grep -E 'request_usage_pkey|Failed to save usage record' -n || true"

# 5. Verify management endpoints for charts/logs
curl -sS -H 'Authorization: Bearer hubmode' 'http://100.96.49.42:4001/v0/management/usage/summary?range=day'
curl -sS -H 'Authorization: Bearer hubmode' 'http://100.96.49.42:4001/v0/management/usage?limit=20&offset=0'
```

**Notes:**
- Graphs and logs both use management usage routes backed by PostgreSQL `request_usage` data.
- Historical series may still display old data; the key recovery signal is that new insert errors stop and fresh rows start appearing.

---

### Scenario: Rollback Issues

**Symptoms:**
```
[ERROR] ROLLBACK ABORTED: No valid backup found
[ERROR] ROLLBACK ABORTED: Backup validation failed
```

**Response:**

```bash
# 1. List available backups
ls -lt ~/.plexus-backups/

# 2. Find latest valid backup
find ~/.plexus-backups -name "runtime-backup-*.tar.gz" -type f | sort -r | head -5

# 3. Verify backup integrity
tar -tzf /path/to/backup.tar.gz

# 4. Rollback to specific backup
./scripts/ai01-rollback.sh --backup-id YYYYMMDD-HHMMSS

# Or use explicit path:
./scripts/ai01-rollback.sh --backup-path /path/to/backup.tar.gz
```

---

### Scenario: Secret Leak Audit

**Symptoms:** Accidental commit of `.env` or backup files containing secrets.

**Immediate Response:**

```bash
# 1. DO NOT push the commit with secrets

# 2. If already committed, remove from history
git rm --cached .env
git commit -m "Remove accidentally committed .env"

# 3. For pushed commits with secrets, use BFG Repo-Cleaner
# Download from: https://rtyley.github.io/bfg-repo-cleaner/

# 4. Rotate exposed credentials
# - Database passwords
# - API keys
# - Service account credentials

# 5. Audit access logs
# Check who cloned/pulled since exposure
```

**Prevention:**
- Always use `${HOME}/.plexus-backups` (outside git)
- Never commit `.env` or backup directories
- Run: `grep -r "password\|secret\|key" . --include="*.tar.gz"` before commits

---

### Scenario: Merge Conflict Requiring Image Rebuild

**Symptoms:**
Merge conflict resolved in temp clone, but local repo still has conflict markers or divergent state.

**Context:**
Temp clone workflow is used when local repo has uncommitted changes or when merge resolution requires build verification before applying to local repo.

**Response:**

```bash
# 1. Note the temp clone path from earlier output (e.g., /tmp/plexus-upstream-run-YYYYMMDD-HHMMSS)
TEMP_CLONE="/tmp/plexus-upstream-run-$(date +%Y%m%d)*"

# 2. Push resolved branch from temp clone to remote
ssh user001@100.96.49.42 "cd ~/plexus-upstream-run-* && git push origin merge/for-main"

# 3. In local repo, fetch and fast-forward to resolved state
cd ~/plexus
git fetch origin
git checkout merge/for-main
git reset --hard origin/merge/for-main

# 4. Verify clean state
git status --short
```

**Image Rebuild Workflow:**

After merge resolution, rebuild the container image on AI01:

```bash
# 1. SSH to AI01 and navigate to temp clone
ssh user001@100.96.49.42
cd ~/plexus-upstream-run-*/plexus

# 2. Build image with podman (remote build)
sudo podman build -t plexus:latest .

# 3. Verify image exists
sudo podman images | grep plexus

# 4. Update runtime config and restart
cd ~/plexus
./stop-plexus.sh
./start-plexus.sh
```

**Verification:**
Run smoke test after image rebuild to confirm successful deployment.

---

### Scenario: Custom Dashboards and Metrics Retention Verification

**Purpose:**
Verify that custom dashboards, A2A routes, and metrics endpoints persist correctly after upstream sync and image rebuild.

**Prerequisites:**
- Plexus container running on AI01
- Network connectivity to AI01 port 4001

**A2A Route Verification:**

| Endpoint | Expected | Command |
|----------|----------|---------|
| `/.well-known/agent-card.json` | HTTP 200 | `curl -s -o /dev/null -w "%{http_code}" http://100.96.49.42:4001/.well-known/agent-card.json` |
| `/a2a/extendedAgentCard` | HTTP 401 (unauthenticated) | `curl -s -o /dev/null -w "%{http_code}" http://100.96.49.42:4001/a2a/extendedAgentCard` |

**Expected Behavior:**
- `/.well-known/agent-card.json` returns 200 with valid JSON card
- `/a2a/extendedAgentCard` returns 401 when accessed without authentication (expected behavior)
- Routes are registered and functional post-rebuild

**Metrics Endpoint Verification:**

| Endpoint | Expected | Command |
|----------|----------|---------|
| `/v0/management/usage` | HTTP 200 | `curl -s -o /dev/null -w "%{http_code}" http://100.96.49.42:4001/v0/management/usage` |
| `/v0/management/usage/summary` | HTTP 200 | `curl -s -o /dev/null -w "%{http_code}" http://100.96.49.42:4001/v0/management/usage/summary` |

**Expected Behavior:**
- Both endpoints return HTTP 200
- Live metrics data is accessible
- Summary metrics load without errors

**Admin Endpoint Note:**
- `/admin` may return non-200 responses and should not be used as a primary health signal
- Use the above endpoints for reliable health verification

---

### Scenario: Config Retention Verification via Checksum

**Purpose:**
Verify that `plexus.yaml` configuration persists unchanged through merge and rebuild cycles.

**Pre-Merge Checksum:**

```bash
# Capture pre-merge checksum
sha256sum ~/plexus/plexus.yaml > /tmp/plexus-pre-merge.sha256
cat /tmp/plexus-pre-merge.sha256
```

**Post-Merge/Restart Verification:**

```bash
# Verify checksum unchanged after operations
sha256sum ~/plexus/plexus.yaml
diff /tmp/plexus-pre-merge.sha256 <(sha256sum ~/plexus/plexus.yaml) && echo "CHECKSUM MATCH" || echo "CHECKSUM DIFFERS"
```

**Expected Result:**
- Pre and post checksums match exactly
- Configuration state is preserved across rebuild/restart cycles

**Note:** `/admin` endpoint should not be relied upon for health verification. Use A2A and metrics endpoints instead.

---

### Known Limitations

**Local Smoke Test Requirements:**

The `ai01-smoke-test.sh` script executes podman and curl checks on AI01 over SSH. Local host requirements are: `ssh`, `bash`, and `python3`.

**Fallback Verification Commands:**

When local smoke test cannot run, use these remote verification commands instead:

```bash
# Verify container running on AI01
ssh user001@100.96.49.42 "sudo podman ps --filter name=plexus --format '{{.Status}}'"

# Verify models endpoint
ssh user001@100.96.49.42 "curl -s http://localhost:4001/v1/models | head -c 100"

# Check recent logs
ssh user001@100.96.49.42 "sudo podman logs --tail=20 plexus"
```

**Operational Sequence Summary:**

```
backup -> merge -> build -> restart -> validate
```

- Backup: Preserve current config and state
- Merge: Apply upstream changes
- Build: Rebuild container image if needed
- Restart: Stop and start Plexus container
- Validate: Verify endpoints and custom dashboards

---

## Operator Checklist

Use this checklist for repeated execution of the sync-and-deploy workflow.

### Pre-Flight

- [ ] Working tree is clean: `git status --porcelain` shows nothing
- [ ] SSH to AI01 works: `ssh user001@100.96.49.42 "echo OK"`
- [ ] No concurrent operations: check for lock files in `/tmp/plexus-*.lock`
- [ ] Backup directory writable: `test -w "$HOME/.plexus-backups"`

### Dry-Run Phase

- [ ] Execute: `./scripts/run-upstream-sync-and-deploy.sh --dry-run`
- [ ] Review expected merge conflicts (if any)
- [ ] Verify backup paths match expected convention
- [ ] Check file transfer list is correct

### Live Execution

- [ ] Execute: `./scripts/run-upstream-sync-and-deploy.sh`
- [ ] Monitor stage output for each: sync, deploy, smoke
- [ ] Verify "ALL CHECKS PASSED" in smoke test
- [ ] Confirm "Pipeline completed successfully" message

### Post-Execution

- [ ] Check AI01 Plexus is accessible: `curl http://100.96.49.42:4001/v1/models`
 [ ] Review backup contents in `~/.plexus-backups/$(date +%Y%m%d)*`
- [ ] Note backup timestamp for potential rollback: `ls -lt ~/.plexus-backups/ | head -2`
- [ ] Clean up old backups if needed (retention policy)

---

## Security Section

### Hidden Backup Root Convention

Sensitive artifacts are stored outside the git repository to prevent accidental commits:

```bash
# Default hidden location
PLEXUS_BACKUP_ROOT="${HOME}/.plexus-backups"

# Structure
~/.plexus-backups/
├── YYYYMMDD-HHMMSS/           # Timestamped session
│   ├── local/                 # Local repo backups
│   └── ai01/                  # Remote AI01 backups
└── deploy-YYYYMMDD-HHMMSS/    # Deploy-specific backups
```

### Git Hygiene Practices

**Never commit these files:**
- `.env` (contains DATABASE_URL with credentials)
- `.plexus-backups/` (backup directories)
- `*.tar.gz` archives from backups
- `database-url.txt` (extracted credentials)
- Any file with `password`, `secret`, or `key` in content

**Pre-commit verification:**

```bash
# Check for secrets in staged files
git diff --cached --name-only | xargs grep -l "DATABASE_URL\|password\|secret" 2>/dev/null || echo "No secrets detected"

# Verify backup directory not in repo
git status | grep -q "\.plexus-backups" && echo "ERROR: Backup directory staged" || echo "OK"
```

**Gitignore guards (already in place):**
```
.env
.plexus-backups/
*.tar.gz
```

### Access Control

```bash
# Restrictive permissions on backup directory
mkdir -p "${HOME}/.plexus-backups"
chmod 700 "${HOME}/.plexus-backups"

# Verify permissions
ls -ld "${HOME}/.plexus-backups"  # Should show drwx------
```

### Incident Response

If secrets are exposed:

1. **Stop** - Do not push additional commits
2. **Remove** - Use `git rm --cached` or BFG Repo-Cleaner
3. **Rotate** - Change all exposed credentials immediately
4. **Audit** - Review access logs for unauthorized access
5. **Document** - Record incident in `.sisyphus/notepads/upstream-sync-ai01/issues.md`

---

## References

- **Security Runbook:** `plexus/docs/runbooks/upstream-sync-security.md`
- **Scripts Location:** `plexus/scripts/`
 **Log Capture:** Use `tee` to save script output; backups stored in `~/.plexus-backups/`
- **Notepad:** `.sisyphus/notepads/upstream-sync-ai01/`
