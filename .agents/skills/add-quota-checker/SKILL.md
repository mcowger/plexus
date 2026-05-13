---
name: add-quota-checker
description: Step-by-step checklist for adding a new quota checker to Plexus. Use whenever asked to implement a new quota checker type — covers backend registration, frontend components, display integration, and common pitfalls.
---

# Adding a New Quota Checker

Every item in this checklist is required. The provider edit modal will not show the new checker type if any registration is missed.

## Backend

### `packages/backend/src/config.ts`
- Add the lowercase checker type string to `VALID_QUOTA_CHECKER_TYPES` array — this drives the `/v0/management/quota-checker-types` API endpoint.

### `packages/backend/src/services/quota/checker-registry.ts`
- Register the checker class in `CHECKER_REGISTRY`.

### `packages/backend/drizzle/schema/postgres/enums.ts`
- Add the type to `quotaCheckerTypeEnum`. (SQLite uses plain `text` and doesn't enforce enum values — Postgres deployments will reject inserts without this.)
- After your PR merges, CI auto-generates the migration. Do **not** create or edit migration files manually.

## Frontend — Config component (`packages/frontend/src/components/quota/`)

### `{Name}QuotaConfig.tsx`
- Props: `options: Record<string, unknown>`, `onChange: (options: Record<string, unknown>) => void`
- Do **not** add an `apiKey` field — it is auto-inherited from the provider config.
- Call `onChange` whenever any option changes.

## Frontend — ProviderQuotaEditor (`packages/frontend/src/components/providers/ProviderQuotaEditor.tsx`)

1. Import the config component at the top.
2. Add an entry to `QUOTA_CONFIG_MAP` mapping the lowercase type string to the component class.

That's it — `ProviderQuotaEditor` handles rendering the config component and wiring up `onChange` generically via the map.

## Frontend — useProviderForm (`packages/frontend/src/hooks/useProviderForm.tsx`)

- Add the lowercase type string to `QUOTA_CHECKER_TYPES_FALLBACK`. This is used as initial state and as a fallback if the API hasn't responded yet.
- If the checker has required options, add validation logic to `validateQuotaChecker()`.

## Frontend — api.ts (`packages/frontend/src/lib/api.ts`)

- Add the lowercase type string to `FALLBACK_QUOTA_CHECKER_TYPES`. This is returned by `getQuotaCheckerTypes()` when the backend API hasn't been fetched yet or fails to respond.

## Frontend — Display name (`packages/frontend/src/components/quota/checker-presentation.ts`)

- Add the type to `CHECKER_DISPLAY_NAMES` map (e.g. `'checker-name': 'Display Name'`).
- This is used by `getCheckerDisplayName()` which is called from `Quotas.tsx`, `CompactQuotasCard`, `CombinedBalancesCard`, and the sidebar.

## Frontend — QuotaDisplay component (optional)

### `{Name}QuotaDisplay.tsx`
- Props: `result: QuotaCheckResult`, `isCollapsed: boolean`
- Rate-limit checkers → progress bar (`QuotaProgressBar`)
- Balance checkers → `Wallet` icon + dollar/points display
- Note: The current UI renders quota data generically via the meter system (`AllowanceMeterRow`, `BalanceMeterRow`). A `QuotaDisplay` component is only needed if the checker requires custom rendering beyond the generic meters. Most checkers do **not** need one.

### `index.ts`
- Export the config component. Only export the display component if you created one.

---

## Hybrid Balance + Rate-Limit Checkers

Some checkers (e.g. neuralwatt) return **both** a dollar balance and a rate-limit window (e.g. monthly kWh). These require extra steps:

1. **Backend** — set `category: 'balance'` (the dollar balance window drives the category).
2. **Display component** — render both the `Wallet`/dollar balance and a progress bar for the monthly window. Follow the `ApertisCodingPlanQuotaDisplay` pattern for the rate-limit part.

---

## Common Mistakes

- **Missing `VALID_QUOTA_CHECKER_TYPES` in `config.ts`**: The backend API will never return the type to the frontend, even if all frontend registrations are correct.
- **Missing Postgres enum**: SQLite ignores enum enforcement; Postgres deployments will reject inserts.
- **Missing `QUOTA_CONFIG_MAP` entry**: The provider edit modal will show the dropdown type but no config form for the checker's options.
- **Missing `CHECKER_DISPLAY_NAMES` entry**: The checker will display as its raw ID instead of a friendly name.
- **Missing `QUOTA_CHECKER_TYPES_FALLBACK` in `useProviderForm.tsx`**: The type won't appear in the dropdown until the API responds (or at all if the API fails).
- **Missing `FALLBACK_QUOTA_CHECKER_TYPES` in `api.ts`**: Same issue — `getQuotaCheckerTypes()` returns this set as a fallback when the cache is empty.
