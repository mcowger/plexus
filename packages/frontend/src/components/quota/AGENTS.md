# Quota Checker Frontend Components

This directory contains display and configuration components for quota checkers. When adding a new quota checker, **every** item in the checklist below must be completed — the provider edit modal will not show the new checker type if any registration is missed.

## Checklist for Adding a New Quota Checker

### Components (this directory)

- [ ] **Config component** — `{Name}QuotaConfig.tsx`
  - Props: `options: Record<string, unknown>`, `onChange: (options: Record<string, unknown>) => void`
  - Do **not** add an `apiKey` field — it is auto-inherited from the provider config
  - Call `onChange` when any option changes

- [ ] **Display component** — `{Name}QuotaDisplay.tsx`
  - Props: `result: QuotaCheckResult`, `isCollapsed: boolean`
  - Rate-limit checkers → progress bar (`QuotaProgressBar`)
  - Balance checkers → `Wallet` icon + dollar/points display

- [ ] **Exports** — `index.ts`
  - Add both `{Name}QuotaConfig` and `{Name}QuotaDisplay` exports

### Providers.tsx (`packages/frontend/src/pages/Providers.tsx`)

- [ ] **Import** the config component at the top of the file
- [ ] **`QUOTA_CHECKER_TYPES_FALLBACK`** array — add the lowercase checker type string (e.g. `'neuralwatt'`)
- [ ] **Config rendering** — add conditional rendering block after the quota checker type/interval selector:
  ```tsx
  {selectedQuotaCheckerType && selectedQuotaCheckerType === 'checkername' && (
    <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
      <CheckerNameQuotaConfig
        options={editingProvider.quotaChecker?.options || {}}
        onChange={(options) =>
          setEditingProvider({
            ...editingProvider,
            quotaChecker: {
              ...editingProvider.quotaChecker,
              options,
            } as Provider['quotaChecker'],
          })
        }
      />
    </div>
  )}
  ```

### Quotas.tsx (`packages/frontend/src/pages/Quotas.tsx`)

- [ ] **Checker display names** — add to the display name map (e.g. `neuralwatt: 'Neuralwatt'`)
- [ ] **Display component rendering** — add the display component to the per-checker rendering map

### API fallback (`packages/frontend/src/lib/api.ts`)

- [ ] **`FALLBACK_QUOTA_CHECKER_TYPES`** Set — add the lowercase checker type string
  - This is used when the `/v0/management/quota-checker-types` API call fails or hasn't completed yet
  - If missing, the type won't appear in the dropdown until the API responds

### Shared display components

- [ ] **`CompactQuotasCard.tsx`** — add checker ID detection, display name, icon prefix, and rendering logic
- [ ] **`CombinedBalancesCard.tsx`** — add to `CHECKER_DISPLAY_NAMES` map if it's a balance-type checker

### Backend (outside this directory, but required for frontend to work)

- [ ] **`packages/backend/src/config.ts`** — add to `VALID_QUOTA_CHECKER_TYPES` array (drives the `/v0/management/quota-checker-types` API endpoint)
- [ ] **`packages/backend/src/services/quota/quota-checker-factory.ts`** — register in `CHECKER_REGISTRY`
- [ ] **`packages/backend/drizzle/schema/postgres/enums.ts`** — add to `quotaCheckerTypeEnum` (CI will generate the migration after merge)

## Hybrid Balance + Rate-Limit Checkers

Some checkers (e.g. neuralwatt) return **both** balance data (dollar credit balance) and rate-limit data (monthly kWh energy quota). These need special handling:

1. **Backend** — the checker still has `category: 'balance'` because it has a dollar balance window.
2. **Display component** — render both the `Wallet`/dollar balance and a progress bar for the monthly window, following the `ApertisCodingPlanQuotaDisplay` pattern for the rate-limit part.
3. **Quotas.tsx** — add the checker type to `BALANCE_CHECKERS_WITH_RATE_LIMIT` so it also appears in the rate-limit section of the Quotas page (not just the generic balance card).
4. **Sidebar.tsx** — add the checker type to `BALANCE_CHECKERS_WITH_RATE_LIMIT` so it appears in both the balance and rate-limit sidebar sections.
5. **CompactQuotasCard.tsx** — add a case to `getTrackedWindowsForChecker` returning the appropriate window types (e.g. `['monthly']`).

## Common Mistakes

- **Missing `FALLBACK_QUOTA_CHECKER_TYPES` in `api.ts`**: The Provider edit modal uses `getQuotaCheckerTypes()` which falls back to this Set when the API hasn't responded yet. If the type is only in `Providers.tsx`'s fallback but not here, the dropdown will be empty until the API call resolves — and if the API call fails, the type won't appear at all.
- **Missing `VALID_QUOTA_CHECKER_TYPES` in `config.ts`**: The backend API endpoint `/v0/management/quota-checker-types` returns this array. If the type is missing, the frontend will never receive it from the server, even if all frontend registrations are correct.
- **Missing Postgres enum**: The `quotaCheckerTypeEnum` must include the type or Postgres deployments will reject inserts. SQLite uses a plain `text` column so it doesn't enforce enum values.
