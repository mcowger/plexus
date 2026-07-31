# Plexus CLI

`@mcowger/plexus-cli` is a Bun-powered command-line client for the Plexus
management API. It discovers the target server's OpenAPI document at runtime,
so documented management operations are available without a CLI update.

## Install or run

Run once with Bun:

```bash
bunx @mcowger/plexus-cli api list
```

Or install the `plexuscli` command globally:

```bash
bun install -g @mcowger/plexus-cli
plexuscli --help
```

## Connect to Plexus

Set the target URL and management key. The local Plexus dev stack defaults to
`password`; use a real admin key for non-local instances.

```bash
export PLEXUS_URL=http://localhost:4000
export PLEXUS_ADMIN_KEY=password

plexuscli api call getV0ManagementAuthVerify
plexuscli api list
```

Use `--url` and `--admin-key` to override the environment for one invocation.

## Agent guidance

Print the packaged skill for complete operational and safety guidance:

```bash
plexuscli skill > SKILL.md
```

The skill covers discovery, JSON request bodies, paginated reads, debug traces,
errors, system logs, and runtime logging/debug configuration.
