---
name: frontend-testing
description: >-
  Verify any Plexus admin-UI screen or component in the actually running app. Boots the worktree-safe
  dev stack (`bun run dev:agent`), auto-logs in, and drives a real browser (agent-browser) using the correct
  port/credentials. Use whenever you edit anything under `packages/frontend/src` (React, routes, forms,
  buttons, tables, modals, Tailwind/CSS, layout, dashboards) or when asked to look at or verify a screen
  (e.g., "screenshot the dashboard", "does the new tab show up", "verify UI", "does the button work",
  "test web app", "reproduce visual bug"). Prefer this over the generic agent-browser skill for local Plexus
  frontend because it knows port, credentials, and auto-login. Don't hand UI work back unverified.
---

# Frontend testing (verify your own UI work)

The point of this skill is self-verification: after you change something in the Plexus
frontend, don't hand it back unverified. Boot the app, look at it through a real browser,
interact with it the way a user would, and confirm it renders and works. This catches the
class of mistakes that typecheck and unit tests miss — a component that throws on mount, a
button wired to nothing, a layout that collapses, a form that never submits.

You already have every piece you need:

- **`bun run dev:full`** — starts a fully-seeded, worktree-safe dev stack (backend + frontend watcher).
- **`bun run dev:get:port`** — tells you which port this worktree uses.
- **agent-browser** — drives a real Chromium browser (load its `core` skill for command syntax).
- **plexus-management** skill — inspects/seeds backend state through the management API when you need to set up or confirm data behind the UI.

This skill wires them together. Follow the steps in order the first time; on later runs you
can skip straight to browsing if the instance is already up.

## Step 0 — Preflight (once per environment)

agent-browser needs a Chromium binary, which may not be installed yet. Install it once; it's
a no-op if already present:

```bash
bunx agent-browser install --with-deps   # --with-deps pulls Linux browser libs; drop it on macOS
```

Note the `bunx` prefix: agent-browser is a dev dependency here, not a global binary, so run
every command as `bunx agent-browser ...`.

## Step 1 — Start or reuse the instance

Use the agent launcher — it does the right thing in one blocking call:

```bash
bun run dev:agent
```

`dev:agent` starts the full stack **detached**, waits until the server is healthy, then returns
while the stack keeps running in the background. Do **not** use `bun run dev:full` directly for
this — it runs in the foreground under a file watcher and never returns, so it will hang your
session. `dev:agent` is also idempotent: if an instance is already up on this worktree's port it
just reports it and exits immediately.

It prints everything you need — capture it:

```
PORT=17508
ADMIN_KEY=password
URL=http://localhost:17508/ui/login?token=password
LOG=/tmp/plexus-dev-<worktree>.log
```

The stack is keyed to the worktree directory name, so each worktree gets its own stable port and
its own database — parallel worktrees never collide. Health is a single sufficient readiness gate
for the whole stack: the backend embeds the built frontend at startup, so it can't report healthy
until the frontend has been built. On the very first boot of a fresh worktree the stack also seeds
data via `prep-dev` and restarts once, so that first `dev:agent` call takes longer than later ones.

If `dev:agent` reports it never became healthy, read the `LOG` path it printed — a common cause is
a real error in the code you just changed (the backend `--watch` crash-loops on a broken import or
a component that fails to build). Another is missing dependencies — run `bun install` first.

## Step 2 — Log in automatically

The remaining steps use `$PORT` and `$ADMIN_KEY`. Set them from the values `dev:agent` printed
(or re-derive the port — it's deterministic per worktree):

```bash
PORT=$(bun run dev:get:port)
ADMIN_KEY="${ADMIN_KEY:-password}"   # dev default is "password" unless you set ADMIN_KEY
```

Skip the login form entirely. The login page accepts the admin key as a `?token=` query
parameter and authenticates on load, so navigate straight there:

```bash
bunx agent-browser open "http://localhost:$PORT/ui/login?token=$ADMIN_KEY"
bunx agent-browser wait --load networkidle
bunx agent-browser snapshot -i        # confirm you've landed in the app, not back on the login form
```

If the snapshot still shows a key input / "Log in" heading, the token was rejected — double-check
`ADMIN_KEY` matches what the running server used (see the `ADMIN_KEY:` line in the dev log at
`/tmp/plexus-dev-<worktree>.log`).

## Step 3 — Drive and inspect the UI

Now exercise whatever you changed. For the exact agent-browser command syntax — snapshots,
element refs, clicking, filling, waiting, screenshots — load its core skill once and follow it;
don't guess flags:

```bash
bunx agent-browser skills get core
```

The essential loop is: `snapshot -i` to see interactive elements and their `@eN` refs → act on a
ref (`click`, `fill`, `type`, `select`) → **re-snapshot**, because refs go stale the instant the
page changes (navigation, submit, re-render, modal open).

Navigate directly to the route you touched rather than clicking through the whole app, e.g.
`bunx agent-browser open "http://localhost:$PORT/ui/<route>"`. Then verify the specific thing you
changed:

- Does the page render without an error boundary / blank screen? (`snapshot -i` should show real content.)
- Does the element you added/changed appear, with the right text and state?
- Does the interaction you wired up actually do something? Click it, then re-snapshot and confirm the expected change.
- Capture a screenshot as evidence (see below).

## Step 4 — Confirm backend state when the UI writes data

If your UI change creates, edits, or deletes something (a provider, key, alias, quota, setting),
don't trust the optimistic UI alone — confirm the change actually persisted. Use the
**plexus-management** skill for this, pointed at your local instance:

```bash
export PLEXUS_BASE_URL="http://localhost:$PORT"
export PLEXUS_ADMIN_KEY="$ADMIN_KEY"
```

Then follow the plexus-management skill to read back the relevant resource (e.g. list providers
after your form submits and check the new one is there). You can also use it in the other
direction — to seed data the UI needs before you test a read/display change.

## Screenshots

Capture a screenshot as evidence of what you verified. Let agent-browser save it to its own
default screenshot directory and use the path it prints in its output — don't fight it with a
custom path (a bare relative path is parsed as a CSS *selector*, not a filename, and a leading
`./` is easy to forget):

```bash
bunx agent-browser screenshot            # prints e.g. "Screenshot saved to /home/.../screenshot-<ts>.png"
```

When you report results, quote that printed path and state plainly what the screenshot shows.

## When you're done

Leave the instance running — it's meant to persist, and reusing it makes your next check instant
(and `dev:agent` will just reuse it). Note in your summary that it's still up on
`http://localhost:$PORT/ui/`. You don't need to close the browser between checks, but
`bunx agent-browser close` frees it. To tear the stack down for this worktree, run
`bun run dev:stop`.

## After editing frontend code mid-session

Both watchers rebuild automatically when you save a file, and the backend `--watch` restarts to
re-embed the rebuilt frontend. So after a further change, give it a moment, re-run
`bun run dev:agent` (it returns as soon as health is stable again), then reload in the browser
(`bunx agent-browser open` the same URL, or a hard reload) before re-checking — otherwise you may
be looking at the pre-change build.

## Troubleshooting

- **`dev:agent` reports never-healthy** → read the dev log at the `LOG` path it printed (`/tmp/plexus-dev-<worktree>.log`). Two common causes: (a) the change you made broke the build or crashes the backend on start; (b) dependencies aren't installed — a `Could not resolve: "react"` (or similar) crash-loop means the worktree needs `bun install` before the stack can boot.
- **`prep-dev` fails / DB looks empty** → the stack only seeds if a data source exists (saved local data or `PLEXUS_STAGING_URL`/`PLEXUS_STAGING_ADMIN_KEY`). Without one, the server still runs fine on an empty DB — seed what you need for the test via the plexus-management skill.
- **Stuck/old process on the port** → `bun run dev:stop` tears down this worktree's stack, then `bun run dev:agent` to start fresh.
- **agent-browser can't launch a browser** → run `bunx agent-browser install --with-deps`. In headless/CI-like environments this can fail two ways: the downloaded Chrome binary may lack the execute bit (`chmod +x ~/.agent-browser/browsers/*/chrome`), and `--with-deps` needs `sudo` to `apt-get install` system libs. Diagnose missing libs with `ldd ~/.agent-browser/browsers/*/chrome | grep 'not found'` and install the matching packages.
- **Login snapshot still shows the form** → the `?token=` key didn't match the server's `ADMIN_KEY`; confirm from the dev log.
- **UI looks stale after an edit** → the watcher hadn't finished; wait for `/health`, then hard-reload.
