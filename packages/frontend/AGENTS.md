# Frontend Development Guidelines

## CSS and assets

- **Never import CSS files with Tailwind directives into `.ts` or `.tsx` files.**
- Build CSS with `@tailwindcss/cli` from `packages/frontend`: input `./src/globals.css`, output `./dist/main.css`. The existing `bun run build:frontend` command from the repository root handles this as part of the frontend build.
- Keep this directive in `packages/frontend/src/globals.css`:

  ```css
  @source "../src/**/*.{tsx,ts,jsx,js}";
  ```

- Put assets in `packages/frontend/src/assets/`.
- Import assets with static ES6 imports only; do not use dynamic asset paths.

## Icons

**Do not use emoji characters in the codebase.** Instead, use Lucide icons from the `lucide-react` library.

For example, replace:
- `ℹ️` → `<Info />`
- `⚠️` → `<AlertTriangle />`
- `✅` → `<CheckCircle />`
- `❌` → `<X />`

Import icons from `lucide-react` and use them as React components.

## Quota Checker Configuration

Use the **`add-quota-checker`** skill for the complete checklist when adding a new quota checker type.
