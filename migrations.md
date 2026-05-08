# DB Migration & Local Testing Plan

## Problem Summary

Two related but distinct problems:

1. **Migration divergence**: locally-generated migration files have different names, timestamps,
   and snapshot UUIDs than CI-generated ones, even for identical schema changes. This causes
   drift between staging and production migration history.

2. **Local testing confidence**: local dev uses dummy data that doesn't reflect production
   shape/volume, so schema changes that work locally can still fail or behave unexpectedly
   on staging.

The root cause of problem 1 is that `drizzle-kit generate` has three sources of
non-determinism: random adjective+hero filename suffixes, `Date.now()` timestamps in the
journal, and `randomUUID()` snapshot IDs. These differ on every run even for identical schema.

---

## Solution: Two-part approach

### Part 1 — Commit migrations on your own branches (fixes divergence)

The "never commit migrations" policy was designed to prevent external contributors from
creating merge conflicts and non-deterministic files. It was not designed to prevent
maintainers from doing it intentionally.

**Maintainer workflow:**

1. Make schema changes in `drizzle/schema/`
2. Use `drizzle-kit push` locally while iterating rapidly (syncs schema directly, no files
   generated, no awkward intermediate migrations)
3. Once happy with the schema, run `drizzle-kit generate` once to produce a clean migration
4. Commit **both** the schema change and the migration files to the branch
5. `deploy_plexus --execute` — the binary embeds the exact migration files that were tested
6. Staging applies the migration cleanly; real data in untouched tables is preserved
7. Further schema changes on the same branch generate incremental delta migrations on top
   of the committed ones — each applies cleanly to staging without losing data

This collapses the divergence problem: since migration files are committed before deploying,
the binary contains exactly the files that were tested. The post-merge CI generation step
finds nothing new to do.

**Policy change needed in `check-no-migrations-in-pr.yml`:**

Update the check to allow migrations committed by maintainers (by GitHub username), while
still blocking them from community/fork PRs. The existing `migrations-ok` label escape hatch
covers this in the interim.

**Iterative schema changes (e.g. TEXT → BOOLEAN mid-development):**

Use `drizzle-kit push` on your local dev server during the iteration phase — it syncs the
DB directly without generating migration files, so there's no awkward TEXT→BOOLEAN sequence
in the history. Generate the single clean migration only when the schema is finalised.

If you've already committed and deployed a migration and need to change it further, just
generate the next delta migration. Staging applies it incrementally; data in other tables
is untouched.

`drizzle-kit drop` is available to remove the last migration from the journal and files if
you need to regenerate it cleanly before it's been deployed anywhere.

---

### Part 2 — `pull_staging` shell function (fixes local testing confidence)

The backup/restore system already exists and is fully capable:
- `GET /v0/management/backup?full=true` — exports a portable `.tar.gz` with config +
  all operational data (request history, provider performance, quotas, etc.)
- `POST /v0/management/restore` — restores from that archive, then restarts the server

Both endpoints are behind `requireAdmin` (Bearer token auth).

**Add this to your shell profile:**

```bash
pull_staging () {
    local staging_url="${PLEXUS_STAGING_URL:?set PLEXUS_STAGING_URL}"
    local staging_key="${PLEXUS_STAGING_ADMIN_KEY:?set PLEXUS_STAGING_ADMIN_KEY}"
    local local_url="${PLEXUS_LOCAL_URL:-http://localhost:4000}"
    local local_key="${PLEXUS_LOCAL_ADMIN_KEY:?set PLEXUS_LOCAL_ADMIN_KEY}"
    local tmp
    tmp=$(mktemp /tmp/plexus-staging-backup-XXXXXX.tar.gz)

    echo "Downloading full backup from staging..."
    curl --fail --silent --show-error \
        -H "Authorization: Bearer ${staging_key}" \
        "${staging_url}/v0/management/backup?full=true" \
        -o "${tmp}"
    if [[ $? -ne 0 ]]; then
        echo "Error: backup download failed" >&2
        rm -f "${tmp}"
        return 1
    fi
    echo "Downloaded $(du -sh "${tmp}" | cut -f1) backup"

    echo ""
    echo "WARNING: This will overwrite your local Plexus database with staging data."
    echo -n "Continue? [y/N] "
    read response
    if [[ ! "${response}" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        rm -f "${tmp}"
        return 0
    fi

    echo "Restoring to local instance..."
    curl --fail --silent --show-error \
        -X POST \
        -H "Authorization: Bearer ${local_key}" \
        -H "Content-Type: application/gzip" \
        --data-binary "@${tmp}" \
        "${local_url}/v0/management/restore"
    local status=$?

    rm -f "${tmp}"

    if [[ $status -ne 0 ]]; then
        echo "Error: restore failed" >&2
        return 1
    fi

    echo ""
    echo "Done. Local instance is restarting with staging data."
}
```

**Set these env vars in your shell profile:**

```bash
export PLEXUS_STAGING_URL=https://your-vps:4000
export PLEXUS_STAGING_ADMIN_KEY=sk-...
export PLEXUS_LOCAL_ADMIN_KEY=sk-...
```

**Note:** the restore triggers a server restart (`process.exit(1)`) after sending the
response. With `bun run dev` the watcher respawns automatically. The `curl` call returns
success before the restart so the function won't hang.

---

## Full development workflow (combined)

```
pull_staging                        # mirror staging data locally
  ↓
drizzle-kit push                    # iterate on schema freely, no migration files
  ↓  (repeat until schema is right)
drizzle-kit generate                # produce one clean migration
git add schema/ migrations/         # commit both together
git commit
  ↓
deploy_plexus --execute             # binary embeds the exact committed migrations
                                    # staging applies the delta, data preserved
  ↓  (if more changes needed)
drizzle-kit generate                # delta migration on top of committed ones
git add / commit / deploy
```

---

## What happens to the CI bot approach (Option D)?

Shelved. The bot approach (generate migrations on branch push, commit back) was designed
to solve the divergence problem for community PRs where contributors can't commit migrations.
That problem still exists for external contributors, but it's lower priority than the
maintainer workflow. The post-merge `generate-migrations.yml` continues to handle community
PR schema changes as today.

If the bot approach is revisited later, the key design decisions are:
- Trigger on `push` to any non-main branch (not just PRs) to cover maintainer branches
- Reset migration folders to main before generating (ensures correct index baseline)
- Infinite-loop guard: skip if `github.actor == 'github-actions[bot]'`
- Generate delta migrations (not squashed) to preserve staging data across iterations
- Update `check-no-migrations-in-pr.yml` to allow bot-authored migration commits

---

## What does NOT change

- `migrate.ts` runtime wrapper — no changes needed
- Schema authoring workflow for external contributors — still submit schema `.ts` only
- Post-merge `generate-migrations.yml` — still handles community PRs
- `pr-tests.yml` — no changes needed
