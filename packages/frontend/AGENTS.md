# Frontend Development Guidelines

## Icons

**Do not use emoji characters in the codebase.** Instead, use Lucide icons from the `lucide-react` library.

For example, replace:
- `ℹ️` → `<Info />`
- `⚠️` → `<AlertTriangle />`
- `✅` → `<CheckCircle />`
- `❌` → `<X />`

Import icons from `lucide-react` and use them as React components.

## Quota Checker Configuration

When adding support for new quota checkers in the frontend, you must create both a display component and a configuration component.

### Display Components

Display components show quota status in the sidebar. They are located in `src/components/quota/` and should be named `{Name}QuotaDisplay.tsx`. Examples:
- `NagaQuotaDisplay.tsx`
- `SyntheticQuotaDisplay.tsx`
- `NanoGPTQuotaDisplay.tsx`

These components receive a `QuotaCheckResult` prop and render the quota status (used/remaining, utilization bar, etc.).

### Configuration Components

Configuration components provide a form for configuring quota checker options. They are located in `src/components/quota/` and should be named `{Name}QuotaConfig.tsx`. Examples:
- `NagaQuotaConfig.tsx` - requires `max` (max balance), optional `apiKey` and `endpoint`
- `SyntheticQuotaConfig.tsx` - optional `apiKey` and `endpoint`
- `NanoGPTQuotaConfig.tsx` - optional `apiKey` and `endpoint`

Each config component must:
1. Accept `options: Record<string, unknown>` and `onChange: (options: Record<string, unknown>) => void` props
2. Render input fields for the required options
3. Call `onChange` when options change

### Integration in Providers.tsx

To add a configuration component to the provider edit modal:

1. Import the config component at the top of `Providers.tsx`
2. Add conditional rendering after the quota checker type/interval selector (around line 1350)
3. Pass the current options and an onChange handler

```tsx
{selectedQuotaCheckerType && selectedQuotaCheckerType === 'naga' && (
  <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
    <NagaQuotaConfig
      options={editingProvider.quotaChecker?.options || {}}
      onChange={(options) => setEditingProvider({
        ...editingProvider,
        quotaChecker: {
          ...editingProvider.quotaChecker,
          options
        } as Provider['quotaChecker']
      })}
    />
  </div>
)}
```

### API Type Update

When adding a new quota checker type that requires options, ensure the `Provider` type in `src/lib/api.ts` includes an `options` field in the `quotaChecker` object:

```typescript
quotaChecker?: {
  type?: string;
  enabled: boolean;
  intervalMinutes: number;
  options?: Record<string, unknown>;
};
```