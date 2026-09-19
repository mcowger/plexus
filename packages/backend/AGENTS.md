# Backend agent rules

## Adding an OAuth provider

A new OAuth provider is **not done** when its auth module works. The
`muse-code` integration (Sep 2026) shipped a working device flow, dispatch
path, quota checker, and model discovery — but the provider never appeared
in the UI because its facade registration was missing. Every item below is
required; verify each against the **live** server, not just unit tests.

### Checklist

1. **Auth module** (`src/services/oauth/{id}.ts`): implement pi-ai's
   `OAuthAuth` (`login` / `refresh` / `toAuth`). Keep credentials opaque —
   parse/encode helpers live beside the flow.
2. **Facade registration** (`src/services/oauth/oauth-providers.ts`): add a
   `CUSTOM_OAUTH_PROVIDERS` entry when pi-ai ships no provider with that id.
   This single registration drives config validation
   (`isKnownOAuthProviderId`), the management UI list
   (`listOAuthProviders`), and login sessions. Without it, everything else
   on this list is dead code from the user's perspective.
3. **Dispatch** (`src/services/oauth/oauth-native-request.ts`): base-URL
   fallback entry (pi-ai has no `baseUrl` for custom providers),
   wire-type mapping, `prepare{Id}OAuthRequest`, and
   `isNativeOAuthProvider` membership. Add same-format bypass in
   `src/services/dispatch/request-payload-builder.ts` when the wire type
   needs it. Provider-specific wire quirks (dropped/rejected fields, tool
   coercions) go in an implicit adapter
   (`src/transformers/adapters/`, registered in `index.ts`, injected in
   `adapter-resolver.ts`) — never in the native prep function.
4. **Quota checker**: follow the **`add-quota-checker`** skill
   (`.agents/skills/add-quota-checker/SKILL.md`), then map the provider id
   to the checker type in `getOAuthCheckerType`
   (`packages/frontend/src/hooks/useProviderForm.tsx`) so the provider form
   auto-selects it.
5. **Model discovery**: add the provider branch in both
   `discoverProviderModels`
   (`src/services/providers/provider-model-discovery.ts`, for configured
   providers) **and** the management login-flow route
   (`src/routes/management/oauth.ts`, for pre-configuration Fetch Models).
   A provider with no pi-ai catalog entry gets an empty list unless both
   are wired.
6. **Tests**: unit tests per seam (auth flow, dispatch headers, checker
   mapping, discovery + fallback, management route). Seed
   `OAuthAuthManager` only after `await manager.initialize()` — the
   constructor's async DB load rebuilds `authData` on landing and wipes
   earlier seeds (flakes only in multi-file runs).

### Verification

- `bun x tsc --noEmit` from `packages/backend`, biome on touched files,
  and the affected vitest suites.
- **Curl the live dev server** (default `ADMIN_KEY=password` locally):
  `curl -H "x-admin-key: password"
  localhost:<port>/v0/management/oauth/providers` must list the new id.
  Unit tests run against the working tree — only the live endpoint proves
  the committed code serves it. When the UI disagrees with the tests, check
  this endpoint first: a missing id means a missing registration, not a
  stale server.
- After every commit: `git show --stat HEAD` must list all intended files
  (see the `git-commit` skill's Verify Every Commit section).
