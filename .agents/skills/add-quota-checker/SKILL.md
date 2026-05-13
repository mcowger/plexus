---
name: add-quota-checker
description: Step-by-step checklist for adding a new quota checker to Plexus. Use whenever asked to implement a new quota checker type — covers backend registration, frontend components, display integration, and common pitfalls.
---

# Adding a New Quota Checker

Every item in this checklist is required. The provider edit modal will not show the new checker type if any registration is missed.

## Backend

### 1. Create the checker file (`packages/backend/src/services/quota/checkers/{name}-checker.ts`)

Implement the checker using `defineChecker()`. The `type` and `displayName` fields on this object are the **sole source of truth** — they drive the API, the frontend dropdown, and all display labels automatically.

```ts
import { defineChecker } from '../checker-registry';
import { z } from 'zod';

export default defineChecker({
  type: 'my-checker',          // lowercase, kebab-case
  displayName: 'My Checker',   // human-readable label shown in the UI
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    // ... fetch and return Meter[]
  },
});
```

### 2. Add the import to `loadAllCheckers()` in `packages/backend/src/services/quota/checker-registry.ts`

```ts
await import('./checkers/my-checker');
```

> **Note:** this manual step exists because Bun does not yet support `import.meta.glob` (tracked in [oven-sh/bun#21459](https://github.com/oven-sh/bun/pull/21459)). When that ships, `loadAllCheckers()` will auto-discover checkers and this step will be removed.

### 3. Add the Zod schema to `packages/backend/src/config.ts`

- Add a `{Name}QuotaCheckerOptionsSchema` const with the checker's options.
- Add a `z.object({ type: z.literal('my-checker'), ... })` entry to `ProviderQuotaCheckerSchema` (the `z.discriminatedUnion`).

### 4. Postgres enum (`packages/backend/drizzle/schema/postgres/enums.ts`)

Add the type string to `quotaCheckerTypeEnum`. SQLite ignores enum enforcement — Postgres deployments will reject inserts without this.

After your PR merges, CI auto-generates the migration. Do **not** create or edit migration files manually.

---

## Frontend — Config component (`packages/frontend/src/components/quota/`)

### `{Name}QuotaConfig.tsx`
- Props: `options: Record<string, unknown>`, `onChange: (options: Record<string, unknown>) => void`
- Do **not** add an `apiKey` field — it is auto-inherited from the provider config.
- Call `onChange` whenever any option changes.

### `index.ts`
- Export the config component.

---

## Frontend — ProviderQuotaEditor (`packages/frontend/src/components/providers/ProviderQuotaEditor.tsx`)

1. Import the config component at the top.
2. Add an entry to `QUOTA_CONFIG_MAP` mapping the lowercase type string to the component.

---

## Frontend — validation (`packages/frontend/src/hooks/useProviderForm.tsx`)

If the checker has required options, add validation logic to `validateQuotaChecker()`.

No fallback lists to update — the frontend fetches all known types from the backend at runtime.

---

## That's it

The `type` and `displayName` you set in `defineChecker()` are automatically:
- Returned by `GET /v0/management/quota-checker-types`
- Returned by `GET /v0/management/quota-checkers` (knownTypes + configured)
- Used in the provider edit modal dropdown
- Used in Quotas page headings, sidebar cards, and all display labels

There are **no frontend constant lists to update**.

---

## Common Mistakes

- **Missing `loadAllCheckers()` import in `checker-registry.ts`**: The checker will never be registered — the registry stays empty for that type, the type won't appear in the dropdown, and the `/v0/management/quota-checker-types` endpoint won't return it.
- **Missing Postgres enum**: SQLite ignores enum enforcement; Postgres deployments will reject inserts.
- **Missing `QUOTA_CONFIG_MAP` entry in `ProviderQuotaEditor`**: The provider edit modal will show the dropdown type but no config form for the checker's options.
- **Missing `ProviderQuotaCheckerSchema` entry in `config.ts`**: The backend Zod validation will reject configs using the new type.
