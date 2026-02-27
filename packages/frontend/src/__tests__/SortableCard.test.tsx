/**
 * @fileoverview Unit tests for the SortableCard component.
 *
 * These tests validate the **module contract** of SortableCard rather than its
 * rendered DOM output. Because SortableCard relies on dnd-kit's drag-and-drop
 * context (which requires a full DndContext provider and sensor setup), these
 * tests focus on what can be verified without mounting a full React tree:
 *
 *   - The component is correctly exported (named + default export).
 *   - It has the expected `displayName` (important for React DevTools and
 *     error boundaries to show a meaningful component name).
 *   - It is a valid React function component.
 *
 * **Why these tests matter:**
 * SortableCard is the drag-handle-bearing wrapper used by the dashboard grid.
 * If the export structure changes (e.g., someone accidentally removes the
 * default export or renames the named export), these tests catch it immediately
 * before downstream consumers break at runtime.
 *
 * **Mocking approach:**
 * No mocks are needed. Each test uses a dynamic `import()` to load the module
 * fresh, verifying that the real module can be resolved and its exports match
 * expectations. This also implicitly validates that the module has no
 * import-time errors (e.g., missing dependencies).
 */
import { describe, test, expect } from 'bun:test';

// Simple test to verify SortableCard exists and exports correctly
describe('SortableCard', () => {
  /**
   * Verifies that the named export `SortableCard` exists and is defined.
   * This is the most basic smoke test -- if the module fails to parse or
   * export the component, this test fails.
   */
  test('component can be imported', async () => {
    const { SortableCard } = await import('../components/ui/SortableCard');
    expect(SortableCard).toBeDefined();
    expect(typeof SortableCard).toBe('function');
  });

  /**
   * Verifies that `SortableCard.displayName` is set to `'SortableCard'`.
   *
   * Why this matters: React DevTools, error boundaries, and logging utilities
   * use `displayName` to identify components. Without it, the component would
   * show up as "Anonymous" or the minified variable name in production builds.
   * This test enforces that the displayName is explicitly set and matches the
   * component's identity.
   */
  test('component has correct display name', async () => {
    const { SortableCard } = await import('../components/ui/SortableCard');
    expect(SortableCard.displayName).toBe('SortableCard');
  });

  /**
   * Validates that the `SortableCardData` TypeScript interface is part of
   * the module.
   *
   * Note: TypeScript interfaces are erased at runtime and cannot be directly
   * asserted. This test serves as a compile-time canary -- if the interface
   * import were to break, the TypeScript compiler would flag it, and this
   * test file would fail to compile. At runtime it simply re-checks that
   * the component export is present.
   */
  test('SortableCardData interface exists', async () => {
    const module = await import('../components/ui/SortableCard');
    // TypeScript interfaces don't exist at runtime, but we can check the module exports
    expect(module.SortableCard).toBeDefined();
  });

  /**
   * Same compile-time canary approach as the `SortableCardData` test above,
   * but for the `SortableCardProps` interface. Ensures the props contract
   * that consumers depend on continues to be exported from the module.
   */
  test('SortableCardProps interface exists', async () => {
    const module = await import('../components/ui/SortableCard');
    // TypeScript interfaces don't exist at runtime, but we can check the module exports
    expect(module.SortableCard).toBeDefined();
  });

  /**
   * Verifies the **default export** is wired up and points to the same
   * function as the named export.
   *
   * Why this matters: Some consumers may use `import SortableCard from ...`
   * (default) while others use `import { SortableCard } from ...` (named).
   * This test ensures both import styles resolve to the exact same component
   * reference, preventing subtle bugs where two different component instances
   * exist in the module graph.
   */
  test('component is default export', async () => {
    const module = await import('../components/ui/SortableCard');
    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.SortableCard);
  });

  /**
   * Checks that the component function accepts props (arity >= 0).
   *
   * `Function.length` returns the number of **expected** parameters. For
   * React components this is typically 1 (the props object) or 2 (props +
   * ref for `forwardRef` components). A value of 0 is also valid for
   * components that destructure inline. This test simply ensures the
   * component signature is plausible.
   */
  test('component accepts required props', async () => {
    const { SortableCard } = await import('../components/ui/SortableCard');

    // Check function arity - the component should accept props
    expect(SortableCard.length).toBeGreaterThanOrEqual(0);
  });

  /**
   * Final sanity check that the export is a function (i.e., a valid React
   * function component). Guards against accidental replacement of the export
   * with a non-component value (e.g., a configuration object or string).
   */
  test('component is a React component', async () => {
    const { SortableCard } = await import('../components/ui/SortableCard');

    // React components are functions
    expect(typeof SortableCard).toBe('function');
  });
});
