/**
 * @fileoverview Unit tests for the `useCardPositions` hook.
 *
 * `useCardPositions` is the persistence layer for the dashboard's drag-and-drop
 * card layout. It manages:
 *   - Loading a saved card order from `localStorage` on mount.
 *   - Falling back to `DEFAULT_CARD_ORDER` when no saved layout exists.
 *   - Reordering cards via `reorderCards(fromIndex, toIndex)`.
 *   - Persisting the new order back to `localStorage` after every reorder.
 *   - Allowing direct replacement of positions via `setPositions()`.
 *   - Guarding against invalid (out-of-bounds) reorder indices.
 *
 * **Why these tests matter:**
 * Card positions are user-personalized state. A regression here could silently
 * wipe a user's saved layout, revert it to defaults, or corrupt the persisted
 * JSON -- all of which are poor UX experiences that are difficult to notice in
 * manual testing.
 *
 * **Test setup and mocking approach:**
 * - `@testing-library/react`'s `renderHook` is used to exercise the hook
 *   outside of a component tree, keeping tests focused on hook logic only.
 * - `localStorage` is cleared in `beforeEach` to isolate each test from
 *   side effects of previous tests. The `typeof window !== 'undefined'` guard
 *   ensures this does not throw in SSR-like test environments.
 * - No external modules are mocked -- the tests run against the real hook
 *   implementation and real `localStorage`, making them true integration-style
 *   unit tests.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useCardPositions } from '../useCardPositions';
import { LAYOUT_STORAGE_KEY, DEFAULT_CARD_ORDER } from '../../types/card';
import type { CardLayout } from '../../types/card';

describe('useCardPositions', () => {
  /**
   * Reset localStorage before each test to ensure a clean slate.
   * This prevents one test's persisted layout from leaking into the next test.
   */
  beforeEach(() => {
    // Clear localStorage before each test
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  });

  /**
   * Verifies the hook's cold-start behavior: when localStorage is empty (no
   * prior user customization), the hook must return the built-in
   * `DEFAULT_CARD_ORDER` so that every card is visible in its canonical
   * position.
   *
   * Also asserts that `isLoaded` is `true` immediately, confirming the hook
   * does not leave the UI in a "loading" state when there is nothing to load.
   */
  test('returns default positions when no saved layout', () => {
    const { result } = renderHook(() => useCardPositions());

    // Wait for effect to run
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.positions).toHaveLength(DEFAULT_CARD_ORDER.length);
  });

  /**
   * Verifies that the hook correctly hydrates from a previously-saved layout
   * in localStorage.
   *
   * This simulates a returning user whose browser has a persisted card order.
   * The test writes a known layout to localStorage **before** rendering the
   * hook, then asserts that the hook's initial positions match the saved data.
   *
   * Why this matters: if deserialization breaks (e.g., JSON schema change or
   * key rename), users would silently lose their customized layout.
   */
  test('loads positions from localStorage', () => {
    const savedLayout = [
      { id: 'requests', order: 0 },
      { id: 'concurrency', order: 1 },
      { id: 'velocity', order: 2 },
      { id: 'provider', order: 3 },
      { id: 'timeline', order: 4 },
      { id: 'modelstack', order: 5 },
    ];
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(savedLayout));

    const { result } = renderHook(() => useCardPositions());

    expect(result.current.isLoaded).toBe(true);
    expect(result.current.positions[0].id).toBe('requests');
  });

  /**
   * Verifies the core drag-and-drop reorder operation: moving the card at
   * index 0 to index 2.
   *
   * After `reorderCards(0, 2)`, the card that was originally first
   * (`DEFAULT_CARD_ORDER[0]`) should now be at index 2. This validates the
   * array splice/insert logic that backs the drag-and-drop interaction.
   */
  test('reorderCards swaps card positions', () => {
    const { result } = renderHook(() => useCardPositions());

    act(() => {
      result.current.reorderCards(0, 2);
    });

    expect(result.current.positions[2].id).toBe(DEFAULT_CARD_ORDER[0]);
  });

  /**
   * Verifies that reordering cards automatically persists the new layout to
   * localStorage.
   *
   * After calling `reorderCards`, the test reads localStorage directly and
   * asserts that:
   *   1. A value exists under `LAYOUT_STORAGE_KEY`.
   *   2. The parsed JSON array has the expected number of entries.
   *
   * Why this matters: without persistence, a page refresh would reset the
   * user's carefully arranged dashboard back to defaults.
   */
  test('saves reordered positions to localStorage', () => {
    const { result } = renderHook(() => useCardPositions());

    act(() => {
      result.current.reorderCards(0, 1);
    });

    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!);
    expect(parsed).toHaveLength(DEFAULT_CARD_ORDER.length);
  });

  /**
   * Verifies the `setPositions` escape hatch, which replaces the entire
   * positions array in one shot.
   *
   * This is used by features that need to programmatically set a layout
   * (e.g., a "reset to defaults" button or a layout preset selector). Unlike
   * `reorderCards` which only moves one card, `setPositions` replaces the
   * whole array, so the test provides a deliberately short array to prove
   * no merging or validation is applied.
   */
  test('setPositions updates positions directly', () => {
    const { result } = renderHook(() => useCardPositions());
    const newLayout: CardLayout = [
      { id: 'concurrency', order: 0 },
      { id: 'velocity', order: 1 },
    ];

    act(() => {
      result.current.setPositions(newLayout);
    });

    expect(result.current.positions).toEqual(newLayout);
  });

  /**
   * Verifies that `reorderCards` is a no-op when given out-of-bounds indices.
   *
   * Passing `(-1, 5)` -- both invalid -- should leave the positions array
   * completely unchanged. This guards against array index errors that could
   * corrupt the layout or throw at runtime when a drag event fires with
   * unexpected coordinates.
   *
   * Why this matters: dnd-kit can occasionally report indices outside the
   * expected range during rapid drag interactions or when the item list
   * changes mid-drag. The hook must handle this gracefully.
   */
  test('ignores invalid reorder indices', () => {
    const { result } = renderHook(() => useCardPositions());
    const originalPositions = result.current.positions;

    act(() => {
      result.current.reorderCards(-1, 5);
    });

    expect(result.current.positions).toEqual(originalPositions);
  });
});
