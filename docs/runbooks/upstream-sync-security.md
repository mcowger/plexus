# Upstream Sync Security Runbook

## Sensitive Artifact Map

This document catalogs sensitive artifacts produced or consumed by the upstream sync process.

### Artifacts with High Sensitivity (Secrets)

| Artifact | Location | Contains | Risk |
|----------|----------|----------|------|
| `.env` | Local repo, AI01 runtime | `DATABASE_URL`, API keys, credentials | Connection strings with passwords |
| `database-url.txt` | Backup dir | Extracted `DATABASE_URL` from AI01 | Same as `.env` |
| `config-files.tgz` | Backup dir | Compressed archive of AI01 `.env`, configs | Bundle of secrets |

### Artifacts with Medium Sensitivity (Operational)

| Artifact | Location | Contains | Risk |
|----------|----------|----------|------|
| `plexus.yaml` | Local repo, AI01 runtime | Provider endpoints, model configs | Operational metadata |
| `start-plexus.sh` | Local repo, AI01 runtime | Startup commands | Deployment procedures |
| `stop-plexus.sh` | Local repo, AI01 runtime | Shutdown commands | Deployment procedures |
| `summary.txt` | Backup dir | Timestamp, paths, commit hashes | Repository structure info |

### Artifacts with Low Sensitivity (Audit)

| Artifact | Location | Contains | Risk |
|----------|----------|----------|------|
| `checksums.txt` | Backup dir | SHA256 hashes of config files | Integrity verification |
| `restored-files.list` | Backup dir | List of files restored post-merge | Audit trail |

## Hidden Storage Convention

### Default Hidden Backup Root

```
# Canonical hidden storage location (outside any git repository)
PLEXUS_BACKUP_ROOT="${HOME}/.plexus-backups"
```

### Storage Hierarchy

```
~/.plexus-backups/
├── YYYYMMDD-HHMMSS/           # Timestamped backup sessions
│   ├── local/                 # Files from local git repo
│   │   ├── .env
│   │   ├── config/plexus.yaml
│   │   ├── start-plexus.sh
│   │   ├── stop-plexus.sh
│   │   └── restored-files.list
│   └── ai01/                  # Files from AI01 remote
│       ├── config-files.tgz
│       ├── database-url.txt
│       └── checksums.txt
└── latest -> YYYYMMDD-HHMMSS/ # Symlink to most recent backup
```

### Environment Overrides

| Variable | Purpose | Default |
|----------|---------|---------|
| `PLEXUS_BACKUP_ROOT` | Hidden backup directory outside repo | `${HOME}/.plexus-backups` |
| `BACKUP_DIR` | Specific backup session directory | `${PLEXUS_BACKUP_ROOT}/${TS}` |

### Security Rationale

1. **Outside Tracked Paths**: Hidden storage is outside the git repository to prevent accidental commits of sensitive data
2. **User-Space Only**: Defaults to user's home directory, avoiding system-wide permissions
3. **Timestamp Isolation**: Each backup session is isolated in timestamped directories
4. **Explicit Override**: Environment variables allow operators to specify alternative locations without modifying scripts

### Migration Path (Future)

Current behavior uses repo-local backups (`${REPO_DIR}/.upstream-backups/`). The hidden storage convention defined here provides:

1. A canonical path for future implementation
2. Clear documentation of intended secure defaults
3. Environment variable hooks for gradual migration

To migrate to hidden storage:
- Set `PLEXUS_BACKUP_ROOT` before running sync
- Or: modify script to prefer hidden path when available

### Access Control

```bash
# Ensure hidden directory has restrictive permissions
mkdir -p "${PLEXUS_BACKUP_ROOT}"
chmod 700 "${PLEXUS_BACKUP_ROOT}"
```

### Cleanup Policy

Backup sessions are retained indefinitely. Implement cleanup separately:

```bash
# Remove backups older than 30 days
find "${PLEXUS_BACKUP_ROOT}" -maxdepth 1 -type d -name "[0-9]*" -mtime +30 -exec rm -rf {} \;
```

## Incident Response

If sensitive data is committed to git:

1. **Do NOT commit the fix** - Use `git rm --cached` or BFG Repo-Cleaner
2. **Rotate exposed credentials** - Database passwords, API keys
3. **Update remote URLs** - If URLs were exposed in `.env`
4. **Audit access logs** - Check who cloned since exposure
