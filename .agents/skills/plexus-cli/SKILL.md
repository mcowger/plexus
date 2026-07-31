---
name: plexus-cli
description: >-
  Use this skill to inspect or administer a running Plexus instance through
  plexuscli. Use it before plexus-rest-api whenever `bun run plexuscli` or
  `plexuscli` is available; it is the preferred interface for live
  request/debug-trace/error/system-log review and runtime configuration.
---

# Plexus Management CLI

Use `plexuscli` to call the Management API. The CLI discovers the running
server's public OpenAPI document on each invocation, so use `api list` and
`api describe` when an operation ID is uncertain.

## Preference

Use this skill whenever either `bun run plexuscli --help` or
`plexuscli --help` succeeds. Use `plexus-rest-api` only when neither command
is available or when this CLI intentionally does not support the required API
operation, such as SSE streaming.

## Local Dev Setup

Get the active worktree server port; do not derive it manually:

```bash
PORT=$(bun run dev:get:port)
export PLEXUS_URL="http://localhost:$PORT"
```

The standard local dev stack uses `password` as its admin key. This is for
local development only; never assume it for staging or production.

```bash
export PLEXUS_ADMIN_KEY=password
```

Run the checkout-local CLI:

```bash
PLEXUSCLI='bun run plexuscli'
```

After installation, use `PLEXUSCLI=plexuscli` instead. Verify access before
making a change:

```bash
$PLEXUSCLI api call getV0ManagementAuthVerify
```

For a remote instance, require `PLEXUS_URL` and `PLEXUS_ADMIN_KEY` from the
user. Never print a supplied key. The CLI does not redact API responses, so
avoid broad key/config reads unless the user requested them.

## CLI Conventions

- `api list` prints the available supported management operations.
- `api describe <operationId>` shows parameters and body requirements.
- `api call <operationId>` invokes an operation. An operation ID alone is a
  shorthand for `api call`.
- Use `--param name=value` for path/query parameters. JSON literals are
  coerced, so `--param limit=50` is numeric and
  `--param fields='["requestId"]'` is an array.
- Use `--body '{...}'` or `--body-file payload.json` for writes.
- Use `--output json|yaml|table`. Non-interactive output defaults to JSON;
  interactive output defaults to a deterministic table.
- Use `--all` only for standardized paginated list operations.
- `DELETE` and operations named delete, restore, restart, reset, clear,
  rotate, or disable prompt for confirmation. Use `--yes` only when the user
  explicitly requested that action.
- The CLI deliberately hides SSE operations, including live system-log
  streaming. Use the recent-log endpoint instead.

## Common Read Workflows

### Inspect Available Operations

```bash
$PLEXUSCLI api list --output table
$PLEXUSCLI api describe getV0ManagementDebugLogs --output yaml
```

### Review Debug Trace Configuration

Debug capture configuration is in memory and resets when Plexus restarts.
Capture is inclusive: global capture, key targets, alias targets, and provider
targets each independently cause a trace to be captured.

```bash
$PLEXUSCLI api call getV0ManagementDebug
```

### Review Recent Debug Traces

List newest traces, then request the full trace by ID:

```bash
$PLEXUSCLI api call getV0ManagementDebugLogs --param limit=50

$PLEXUSCLI api call getV0ManagementDebugLogsByrequestId \
  --param requestId='<request-id>' \
  --output json
```

Trace payloads and headers can contain customer data or secrets. Report only
the specific redacted fields needed to diagnose the issue.

### Review Inference Errors

```bash
$PLEXUSCLI api call getV0ManagementErrors --param limit=50

# Retrieve every documented error page only when the user needs the full set.
$PLEXUSCLI api call getV0ManagementErrors --all --param limit=100
```

### Review Recent System Logs

```bash
$PLEXUSCLI api call getV0SystemLogsRecent --param limit=100

$PLEXUSCLI api call getV0SystemLogsRecent --all --param limit=100
```

The recent-log endpoint is bounded in memory. It is not a persistent audit
log, and `--all` can only retrieve entries the server still retains.

## Runtime Configuration Workflows

Inspect the current state before changing it. State the intended change to the
user, then send the smallest PATCH/PUT body that satisfies the API.

### Adjust Debug Trace Capture

Enable temporary global capture:

```bash
$PLEXUSCLI api call patchV0ManagementDebug --body '{"enabled":true}'
```

Capture only selected request dimensions while global capture stays off:

```bash
$PLEXUSCLI api call patchV0ManagementDebug \
  --body '{"enabled":false,"keys":["mobile-app"],"aliases":["support"],"providers":["openai"]}'
```

Clear provider targeting and disable global capture after the investigation:

```bash
$PLEXUSCLI api call patchV0ManagementDebug \
  --body '{"enabled":false,"providers":null}'
```

`keys`, `aliases`, and `providers` replace their corresponding target lists;
send `null` or `[]` to clear one. Do not leave broad debug capture enabled
longer than required.

### Adjust Runtime Log Verbosity

Read the current and startup log levels:

```bash
$PLEXUSCLI api call getV0ManagementLoggingLevel
```

Increase temporary detail:

```bash
$PLEXUSCLI api call putV0ManagementLoggingLevel --body '{"level":"debug"}'
```

Valid levels, least to most verbose: `error`, `warn`, `info`, `debug`,
`verbose`, `silly`. The setting is runtime-only and reverts on restart.

Reset it to the startup default only when explicitly requested:

```bash
$PLEXUSCLI api call deleteV0ManagementLoggingLevel --yes
```

## Failure Handling

- If spec discovery fails, confirm the URL with `bun run dev:get:port` locally
  or ask for the remote base URL.
- If an operation ID is unavailable, run `api list`; do not guess a path or
  substitute raw HTTP requests.
- On HTTP validation errors, report the exact response and stop rather than
  guessing a new payload.
- For a 401/403, verify the correct `PLEXUS_ADMIN_KEY` was supplied and do not
  retry with unrelated credentials.
