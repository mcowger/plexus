# OpenAPI Sync Tool

Automated tool to keep OpenAPI definitions in sync with Fastify route implementations.

## Overview

This script scans the Fastify route files in `packages/backend/src/routes/` and compares them against the OpenAPI definitions in `docs/openapi/`. It helps identify:

- Routes implemented in code but missing from OpenAPI documentation
- OpenAPI paths that don't exist in the code (stale documentation)
- HTTP method mismatches between code and documentation

## Usage

### Check for missing endpoints (dry run)

```bash
bun run sync:openapi
```

This scans all routes and reports discrepancies without making any changes.

### Generate missing OpenAPI files

```bash
bun run sync:openapi:write
```

Generates skeleton OpenAPI path files for missing endpoints. After running:

1. Edit the generated files to add proper descriptions, schemas, and examples
2. Run `bun run lint:openapi` to validate
3. Update `docs/openapi/openapi.yaml` to include the new path references
4. Commit the changes

### Quiet mode

```bash
bun run sync:openapi --quiet
```

Only outputs errors, useful for CI/CD pipelines.

## How It Works

### Route Detection

The script scans TypeScript files for Fastify route registrations:

```typescript
fastify.get('/path', handler)
mgmt.post('/path', handler)
app.put('/path', handler)
```

It handles both single-line and multi-line route definitions.

### Path Normalization

The script normalizes path parameters for comparison:

| Code Pattern | OpenAPI Pattern | Normalized |
|-------------|----------------|------------|
| `:id` | `{id}` | `{id}` |
| `:slug` | `{slug}` | `{slug}` |
| `*` | `{wildcard}` | `{wildcard}` |

### Tag Assignment

When generating new OpenAPI files, the script automatically assigns tags based on the route path:

- `/v0/management/config/*` → `Management — Config`
- `/v0/management/quotas/*` → `Management — Quotas (Provider)`
- `/v0/management/oauth/*` → `Management — OAuth`
- `/v1/*` → `Inference`
- `/mcp/*` → `MCP`

## Known Limitations

### Wildcard Routes

Routes using `*` wildcards (e.g., `/v0/management/providers/*`) are reported as missing even if OpenAPI documents them with named parameters (e.g., `/v0/management/providers/{slug}`). This is expected - the OpenAPI version is more descriptive and should be kept.

### Nested Routers

Routes registered via `fastify.register()` with nested routers may not be detected if they use custom route registration patterns.

### UI Routes

Frontend routes (e.g., `/ui/*`, `/`) are detected but typically don't need OpenAPI documentation.

## Best Practices

### When Adding New Routes

1. **Create the route** in the appropriate file under `packages/backend/src/routes/`
2. **Run the sync tool** to check if OpenAPI is missing
3. **Generate skeleton** with `bun run sync:openapi:write` (optional)
4. **Document the endpoint** in OpenAPI with:
   - Clear summary and description
   - Request/response schemas
   - Security requirements
   - Example requests/responses
5. **Validate** with `bun run lint:openapi`

### Regular Maintenance

Run the sync tool periodically to catch drift:

```bash
# Before committing
bun run sync:openapi

# In CI/CD (fails if routes are undocumented)
bun run sync:openapi --quiet || echo "Warning: Some routes missing from OpenAPI"
```

## Integration with Lefthook

Consider adding OpenAPI sync check to your pre-commit hooks:

```yaml
# .lefthook.yml
pre-commit:
  commands:
    openapi-sync:
      run: bun run sync:openapi --quiet
      skip:
        - merge
        - rebase
```

## Files

- `scripts/sync-openapi.ts` - Main sync script
- `docs/openapi/openapi.yaml` - Main OpenAPI specification
- `docs/openapi/paths/` - Individual path definition files
- `packages/backend/src/routes/` - Fastify route implementations

## Examples

### Example 1: Check before committing

```bash
$ bun run sync:openapi
🔄 OpenAPI Sync Tool
   Routes: packages/backend/src/routes
   OpenAPI: docs/openapi

================================================================================
📊 OpenAPI Sync Report
================================================================================

✅ Routes found: 132
📝 OpenAPI paths: 97

✨ All routes are documented in OpenAPI!
```

### Example 2: Generate missing files

```bash
$ bun run sync:openapi:write
🔄 OpenAPI Sync Tool

❌ Missing from OpenAPI: 3 endpoint(s)
   POST /v0/management/test

📝 Generating missing OpenAPI files...
✅ Created: v0_management_test.yaml

✨ Generated 1 OpenAPI path file(s)
📝 Next steps:
   1. Edit the generated files to add proper descriptions and schemas
   2. Run: bun run lint:openapi
   3. Update docs/openapi/openapi.yaml to include the new paths
```

## Troubleshooting

### Script doesn't detect my routes

Check that your routes follow the expected pattern:

```typescript
// ✅ Detected
fastify.get('/path', handler)
mgmt.post('/path', handler)

// ❌ Not detected (dynamic path)
const path = '/path';
fastify.get(path, handler)

// ❌ Not detected (variable method)
const method = 'get';
fastify[method](path, handler)
```

### False positives for wildcard routes

This is expected. Wildcard routes in code (`*`) are often documented with named parameters in OpenAPI (`{slug}`). The OpenAPI version is preferred for documentation clarity.

### Script fails with YAML parsing errors

Ensure your OpenAPI files are valid YAML. Run:

```bash
bun run lint:openapi
```

to check for syntax errors.
