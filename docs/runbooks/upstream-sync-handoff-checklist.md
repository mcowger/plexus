# Upstream Sync Operational Handoff Checklist

Handoff document for AI01 Plexus upstream sync operations. Use this checklist during shift transitions or when resuming interrupted work.

---

## Quick Reference: Copy/Paste Commands

### Run the Pipeline

```bash
# Full pipeline: sync -> deploy -> smoke test
bash plexus/scripts/run-upstream-sync-and-deploy.sh

# Dry run first (recommended)
bash plexus/scripts/run-upstream-sync-and-deploy.sh --dry-run

# Skip sync (deploy current state only)
bash plexus/scripts/run-upstream-sync-and-deploy.sh --skip-sync

# Skip deploy (sync and smoke only)
bash plexus/scripts/run-upstream-sync-and-deploy.sh --skip-deploy

# Disable automatic rollback on failure
bash plexus/scripts/run-upstream-sync-and-deploy.sh --no-rollback
```

### Verify Deployment

```bash
# Run smoke tests
bash plexus/scripts/ai01-smoke-test.sh

# Verbose smoke test
bash plexus/scripts/ai01-smoke-test.sh --verbose

# Manual curl check
curl -s http://100.96.49.42:4001/v1/models | head -c 200

# Check git status (should be clean after sync)
git status --porcelain
```

### Rollback Commands

```bash
# Rollback to latest backup
bash plexus/scripts/ai01-rollback.sh

# Rollback to specific backup by ID
bash plexus/scripts/ai01-rollback.sh --backup-id 20260221-223730

# Rollback from explicit path
bash plexus/scripts/ai01-rollback.sh --backup-path ~/.plexus-backups/deploy-20260221-223730/runtime-backup-20260221-223730.tar.gz

# Preview rollback (dry run)
bash plexus/scripts/ai01-rollback.sh --dry-run
```

---

## Pre-Flight Checklist

Before starting any operation, verify:

- [ ] **Working tree clean**: `git status --porcelain` returns empty
- [ ] **SSH connectivity**: `ssh -o ConnectTimeout=5 user001@100.96.49.42 "echo OK"` returns `OK`
- [ ] **No concurrent operations**: Check `/tmp/plexus-*.lock` files do not exist
- [ ] **Backup directory exists**: `test -w "$HOME/.plexus-backups"` returns true

### Known Constraints (from Tasks 15/16)

| Constraint | Impact | Resolution |
|------------|--------|------------|
| **Dirty tree sync gate** | `update-from-upstream.sh` exits if uncommitted changes exist | Use `--skip-sync` or commit changes first |
| **Tracked *.backup files** | 3 files remain tracked despite `.gitignore` pattern | Must `git rm --cached` before committing |
| **Workspace structure** | Runtime files are in workspace root, not `plexus/` subdirectory | Copy files or use `--skip-sync` for deploy-only |

---

## Run Phase: Sync, Deploy, and Smoke

### Full Pipeline Execution

```bash
bash plexus/scripts/run-upstream-sync-and-deploy.sh
```

**What happens:**
1. **Sync**: Fetch upstream mcowger/plexus, merge, preserve local config
2. **Deploy**: Transfer `.env`, `plexus.yaml`, `start-plexus.sh`, `stop-plexus.sh` to AI01
3. **Smoke**: Verify container running, endpoint returns 200, no errors in logs

**On failure:** Automatic rollback to last backup (unless `--no-rollback`)

### Stage-Specific Commands

| Stage | Script | Key Flags |
|-------|--------|-----------|
| Sync | `update-from-upstream.sh` | `--dry-run` |
| Deploy | `deploy-to-ai01.sh` | `--dry-run` |
| Smoke | `ai01-smoke-test.sh` | `--verbose` |

---

## Verify Phase: Post-Deployment Checks

### Automated Smoke Test

```bash
bash plexus/scripts/ai01-smoke-test.sh
```

**Checks performed:**
1. Container exists and is running (via `sudo podman ps`)
2. `/v1/models` returns HTTP 200
3. Response JSON contains `object=list` and `data` array
4. `DATABASE_URL` env var set with `postgresql://` prefix
5. Last 50 log lines contain no critical errors

### Manual Verification Commands

```bash
# Container status
ssh user001@100.96.49.42 "sudo podman ps --filter name=plexus"

# Models endpoint
curl -s -w '\nHTTP_CODE:%{http_code}' http://100.96.49.42:4001/v1/models

# Recent logs
ssh user001@100.96.49.42 "sudo podman logs --tail=50 plexus"

# Database URL check (value masked in output)
ssh user001@100.96.49.42 "sudo podman exec plexus env | grep DATABASE_URL"
```

### Expected Results

| Check | Expected | Failure Indicators |
|-------|----------|-------------------|
| Container | `Up` status | Container does not exist, status `Exited` |
| HTTP Status | `200` | `502`, `404`, timeout |
| JSON Structure | `{"object":"list","data":[...]}` | Missing fields, parse errors |
| DATABASE_URL | Starts with `postgresql://` | Missing, wrong prefix, empty |
| Logs | No `FATAL`, `ERROR.*database`, `panic` | Migration failed, connection refused |

---

## Rollback Phase: Recovery Commands

### Automatic Rollback (Orchestrator)

The orchestrator automatically invokes rollback on stage failure:

```
sync -> deploy -> smoke
  |       |        |
  v       v        v
FAILED  FAILED   FAILED
  |       |        |
  +-------+--------+
          |
          v
    ai01-rollback.sh
```

### Manual Rollback

```bash
# Latest backup (default)
bash plexus/scripts/ai01-rollback.sh

# Specific backup by timestamp
bash plexus/scripts/ai01-rollback.sh --backup-id 20260221-223730

# Explicit backup file path
bash plexus/scripts/ai01-rollback.sh --backup-path ~/.plexus-backups/deploy-20260221-223730.tar.gz
```

**What rollback does:**
1. Resolves backup (latest, by ID, or explicit path)
2. Validates backup integrity with `tar -tzf`
3. Creates pre-rollback backup of current state
4. Stops Plexus via `stop-plexus.sh`
5. Extracts rollback archive to AI01 directory
6. Sets permissions (`.env` 600, scripts executable)
7. Starts Plexus via `start-plexus.sh`
8. Runs smoke test to verify rollback success

### Rollback Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success (smoke test passed) | Verify manually if needed |
| 1 | Backup not found, validation failed, or smoke test failed | Check backup locations, fix issues, retry |
| 3 | Lock contention (concurrent operation) | Wait and retry |

---

## Backup and Evidence Locations

### Local Backup Directory

```
~/.plexus-backups/
├── YYYYMMDD-HHMMSS/                    # From update-from-upstream.sh
│   ├── local/
│   │   ├── .env
│   │   ├── plexus.yaml
│   │   ├── start-plexus.sh
│   │   ├── stop-plexus.sh
│   │   ├── restored-files.list
│   │   └── preserve-manifest.sha256
│   ├── ai01/
│   │   ├── config-files.tgz
│   │   ├── database-url.txt
│   │   └── checksums.txt
│   └── summary.txt
└── deploy-YYYYMMDD-HHMMSS/             # From deploy-to-ai01.sh
    └── runtime-backup-YYYYMMDD-HHMMSS.tar.gz
```

### AI01 Remote Backup Directory

```
~/plexus/.plexus-backups/
└── runtime-backup-YYYYMMDD-HHMMSS.tar.gz
```

### Evidence Files

```
.sisyphus/evidence/
├── task-14-dryrun-stages.txt           # Dry-run gate behavior
├── task-14-dryrun-no-mutation.txt      # No-mutation verification
├── task-15-live-recovery.txt           # Recovery behavior (deploy failed, rollback attempted)
├── task-16-secret-audit-fail.txt       # Secret leak audit (tracked backup files found)
└── task-17-handoff-complete.txt        # This handoff evidence
```

### Notepad

```
.sisyphus/notepads/upstream-sync-ai01/
├── decisions.md
├── issues.md
├── learnings.md                        # Operational knowledge
└── problems.md
```

---

## Troubleshooting Quick Reference

### Scenario: Sync Fails with "Uncommitted changes"

**Symptom:**
```
[ERROR] Working tree has uncommitted changes
```

**Response:**
```bash
# Option 1: Commit changes first
git add <files>
git commit -m "Prepare for upstream sync"
bash plexus/scripts/run-upstream-sync-and-deploy.sh

# Option 2: Skip sync, deploy only
bash plexus/scripts/run-upstream-sync-and-deploy.sh --skip-sync
```

### Scenario: Deploy Fails with "Missing local file"

**Symptom:**
```
[ERROR] Missing local file: .env
[ERROR] Missing local file: plexus.yaml
```

**Response:**
```bash
# Verify files exist in workspace root
ls -la ~/.env ~/plexus.yaml ~/start-plexus.sh ~/stop-plexus.sh

# Copy to expected location (plexus subdirectory)
cp ~/.env plexus/
cp ~/plexus.yaml plexus/
cp ~/start-plexus.sh plexus/
cp ~/stop-plexus.sh plexus/

# Retry deploy
bash plexus/scripts/run-upstream-sync-and-deploy.sh --skip-sync
```

### Scenario: Smoke Test Fails with HTTP 502

**Symptom:**
```
[FAIL] Models Endpoint: HTTP 502 (expected 200)
```

**Response:**
```bash
# Check container status
ssh user001@100.96.49.42 "sudo podman ps -a | grep plexus"

# View recent logs
ssh user001@100.96.49.42 "sudo podman logs --tail=100 plexus"

# If rollback available
bash plexus/scripts/ai01-rollback.sh
```

### Scenario: Rollback Fails with "No valid backup found"

**Symptom:**
```
[ERROR] No valid backup found in: /home/user001/.plexus-backups
```

**Response:**
```bash
# List available backups
ls -lt ~/.plexus-backups/

# Find runtime backups
find ~/.plexus-backups -name "runtime-backup-*.tar.gz" -type f | sort -r | head -5

# Verify backup integrity
tar -tzf /path/to/backup.tar.gz

# Rollback to specific backup
bash plexus/scripts/ai01-rollback.sh --backup-path /path/to/backup.tar.gz
```

### Scenario: Backup Files Still Tracked by Git

**Symptom:**
```
config/plexus.metrics.yaml.backup
packages/frontend/src/pages/Config.tsx.backup
packages/frontend/src/pages/Keys.tsx.backup
```

**Response:**
```bash
# Remove from tracking (preserves files in working directory)
git rm --cached config/plexus.metrics.yaml.backup
git rm --cached packages/frontend/src/pages/Config.tsx.backup
git rm --cached packages/frontend/src/pages/Keys.tsx.backup
git commit -m "Remove tracked backup files (should be ignored)"
```

---

## Contact and References

### Related Documentation

- **Operations Runbook**: `plexus/docs/runbooks/upstream-sync-operations.md`
- **Security Runbook**: `plexus/docs/runbooks/upstream-sync-security.md`
- **Scripts Location**: `plexus/scripts/`
- **Evidence Location**: `.sisyphus/evidence/`

### SSH Target

- **Host**: `user001@100.96.49.42`
- **Plexus Directory**: `~/plexus`
- **Plexus Endpoint**: `http://100.96.49.42:4001/v1/models`

---

## Sign-Off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Outgoing Operator | | | |
| Incoming Operator | | | |
| Status | | | |

---

*Generated from Task 17: Generate final operational handoff checklist*
*Evidence: `.sisyphus/evidence/task-17-handoff-complete.txt`*
