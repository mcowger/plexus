/**
 * @file useCardPositions -- Persistence layer for the draggable card layout.
 *
 * This hook owns the **read, validate, reorder, and persist** lifecycle for the
 * card layout on the Live Metrics dashboard. It bridges the gap between the
 * ephemeral in-memory state that @dnd-kit operates on and the durable layout
 * stored in `localStorage` so that a user's custom card order survives page
 * refreshes and browser restarts.
 *
 * ## Data flow
 *
 * ```
 *  localStorage  --[read on mount]-->  positions state  --[render]-->  SortableCard[]
 *       ^                                    |
 *       |                                    v
 *       +------[write on change]-------  useEffect
 * ```
 *
 * ## Validation strategy
 *
 * Saved layouts can become stale when the codebase evolves (cards added or removed).
 * On every mount, the hook validates the saved layout against `defaultOrder`:
 *  - Every ID in `defaultOrder` must exist in the saved data (no missing cards).
 *  - The saved data must have exactly the same length as `defaultOrder` (no extra cards).
 * If either check fails, the saved layout is discarded and the default order is used.
 * This is intentionally strict -- a partial migration would risk showing a broken or
 * incomplete dashboard. Falling back to the default is always safe.
 *
 * ## SSR safety
 *
 * All `localStorage` access is guarded behind `typeof window === 'undefined'` checks
 * so that this hook can be imported in SSR / Node.js test environments without errors.
 */

import { useState, useEffect, useCallback } from 'react';
import type { CardId, CardLayout } from '../types/card';
import { DEFAULT_CARD_ORDER, LAYOUT_STORAGE_KEY } from '../types/card';

/**
 * Shape of the object returned by `useCardPositions`.
 *
 * @property positions    - The current ordered array of card positions. Always sorted
 *                          by the `order` field. This is the array the dashboard maps
 *                          over to render cards in the correct sequence.
 * @property setPositions - Directly replace the entire layout. Useful if the parent
 *                          needs to apply a bulk update (e.g., importing a layout).
 * @property reorderCards - Move a single card from `oldIndex` to `newIndex`. This is
 *                          the primary callback wired to @dnd-kit's `onDragEnd` event.
 *                          It performs an array splice, recalculates contiguous order
 *                          values, and triggers a persist to localStorage.
 * @property isLoaded     - `true` once the initial load from localStorage (or fallback
 *                          to defaults) has completed. The dashboard should not render
 *                          cards until this is `true` to avoid a flash of default order
 *                          followed by a jump to the saved order.
 */
export interface UseCardPositionsReturn {
  /** Current card positions, sorted by `order` ascending. */
  positions: CardLayout;
  /** Replace the entire layout at once (triggers localStorage persist). */
  setPositions: (layout: CardLayout) => void;
  /** Reorder cards by moving one card from oldIndex to newIndex. */
  reorderCards: (oldIndex: number, newIndex: number) => void;
  /** `true` once positions have been loaded from storage (or defaults applied). */
  isLoaded: boolean;
}

/**
 * Custom hook for managing card positions with localStorage persistence.
 *
 * Designed to be used as a singleton per dashboard page -- call it once at the
 * dashboard level and pass the returned `positions` array down to the sortable
 * container. Calling it in multiple components would create separate state copies
 * that could drift out of sync.
 *
 * @param defaultOrder - Optional override for the default card order. Falls back to
 *                        `DEFAULT_CARD_ORDER` from `types/card.ts`. This parameter
 *                        exists primarily for testing (injecting a smaller card set)
 *                        but could also support per-page layouts in the future.
 * @returns An object containing the current positions, mutation functions, and a
 *          loading flag. See `UseCardPositionsReturn` for details.
 */
export function useCardPositions(
  defaultOrder: CardId[] = DEFAULT_CARD_ORDER
): UseCardPositionsReturn {
  /**
   * The canonical layout state. Always an array of `CardPosition` objects sorted
   * by `order`. Initialised as empty and populated in the mount effect below.
   */
  const [positions, setPositionsState] = useState<CardLayout>([]);

  /**
   * Guards against rendering before the initial load completes. Without this,
   * the dashboard would briefly render zero cards (empty initial state), then
   * flash to the loaded layout, causing a visible layout shift.
   */
  const [isLoaded, setIsLoaded] = useState(false);

  // ---------------------------------------------------------------------------
  // EFFECT: Load positions from localStorage on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // SSR guard: skip localStorage access in server-side / test environments.
    if (typeof window === 'undefined') {
      setIsLoaded(true);
      return;
    }

    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as CardLayout;

        // --- Validation against defaultOrder ---
        //
        // We check two conditions to decide whether the saved layout is still valid:
        //
        // 1. `hasAllCards` -- Every card ID in the current `defaultOrder` must appear
        //    in the saved data. This catches the case where a developer has added a
        //    NEW card to the dashboard: the saved layout would be missing the new ID,
        //    so we discard it and fall back to defaults (which include the new card).
        //
        // 2. `parsed.length === defaultOrder.length` -- The saved data must not contain
        //    MORE entries than expected. This catches the case where a card was REMOVED
        //    from the codebase: the saved layout would have an extra entry for the
        //    deleted card, which would cause a runtime error when the dashboard tries
        //    to render a card component that no longer exists.
        //
        // Together, these two checks ensure the saved layout is an exact 1-to-1 match
        // with the current set of known cards. Any mismatch triggers a full reset to
        // defaults -- we intentionally do NOT attempt partial merges because they would
        // require guessing where to insert new cards or which old cards to drop, and
        // getting that wrong could produce a confusing layout.
        const savedIds = new Set(parsed.map((p) => p.id));
        const hasAllCards = defaultOrder.every((id) => savedIds.has(id));
        if (hasAllCards && parsed.length === defaultOrder.length) {
          // Saved layout is valid -- sort by the persisted order values to ensure
          // the array is in the correct visual sequence.
          const sorted = [...parsed].sort((a, b) => a.order - b.order);
          setPositionsState(sorted);
          setIsLoaded(true);
          return;
        }
        // If we reach here, the saved layout failed validation. Fall through to
        // the default layout below. The stale localStorage entry will be overwritten
        // on the next persist cycle (the "save" effect fires when `positions` changes).
      }
    } catch (error) {
      // JSON.parse failure, localStorage quota error, or other runtime exception.
      // Log a warning and fall through to defaults so the dashboard still renders.
      console.warn('Failed to load card layout from localStorage:', error);
    }

    // No saved layout, or saved layout was invalid -- build from defaultOrder.
    // Each card gets an `order` value equal to its array index.
    const defaultLayout: CardLayout = defaultOrder.map((id, index) => ({
      id,
      order: index,
    }));
    setPositionsState(defaultLayout);
    setIsLoaded(true);
  }, [defaultOrder]);

  // ---------------------------------------------------------------------------
  // EFFECT: Persist positions to localStorage whenever they change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Don't persist until the initial load has completed. Without this guard,
    // the empty initial state ([]) would be written to localStorage on mount,
    // erasing the user's saved layout before the load effect has a chance to
    // read it.
    if (!isLoaded || typeof window === 'undefined') return;

    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(positions));
    } catch (error) {
      // localStorage can throw if the user's storage quota is exceeded or if
      // the browser is in a private/incognito mode that restricts writes.
      // We log a warning but do not interrupt the user's session -- the layout
      // will still work in memory, it just won't survive a page refresh.
      console.warn('Failed to save card layout to localStorage:', error);
    }
  }, [positions, isLoaded]);

  /**
   * Directly replace the entire card layout.
   *
   * This is a low-level setter exposed for advanced use cases (e.g., importing
   * a layout from a shared URL or resetting to defaults). For standard drag-and-drop
   * reordering, prefer `reorderCards` which handles the splice logic internally.
   *
   * Triggers a localStorage persist via the save effect above.
   */
  const setPositions = useCallback((layout: CardLayout) => {
    setPositionsState(layout);
  }, []);

  /**
   * Reorder cards by moving a single card from `oldIndex` to `newIndex`.
   *
   * This is the primary callback wired to @dnd-kit's `onDragEnd` handler. The
   * parent component translates dnd-kit's `active` and `over` IDs into array
   * indices, then calls this function.
   *
   * The implementation mirrors @dnd-kit's `arrayMove` utility:
   *  1. Splice the card out of its old position.
   *  2. Splice it back in at the new position.
   *  3. Recalculate all `order` values to be contiguous (0, 1, 2, ...).
   *
   * Step 3 is important because the `order` field is what gets persisted to
   * localStorage. If we only moved the card without recalculating, we could end
   * up with gaps or duplicates in the order values, which would cause incorrect
   * sorting on the next page load.
   *
   * Bounds checking is performed before any mutation. Out-of-range indices are
   * logged as warnings and silently ignored to prevent corrupting the layout
   * state with an invalid splice operation.
   *
   * @param oldIndex - The current array index of the card being moved.
   * @param newIndex - The target array index where the card should be inserted.
   */
  const reorderCards = useCallback(
    (oldIndex: number, newIndex: number) => {
      // Guard against invalid indices that would corrupt the array.
      if (
        oldIndex < 0 ||
        oldIndex >= positions.length ||
        newIndex < 0 ||
        newIndex >= positions.length
      ) {
        console.warn('Invalid reorder indices:', { oldIndex, newIndex, length: positions.length });
        return;
      }

      // Clone the array to avoid mutating React state directly.
      const newPositions = [...positions];

      // Remove the card from its old position.
      const [movedCard] = newPositions.splice(oldIndex, 1);

      // Insert it at the new position.
      newPositions.splice(newIndex, 0, movedCard);

      // Recalculate contiguous order values (0, 1, 2, ...) so that the persisted
      // layout always has clean, sequential indices. This avoids edge cases where
      // repeated reorders could produce non-contiguous order values.
      const reordered: CardLayout = newPositions.map((card, index) => ({
        ...card,
        order: index,
      }));

      setPositionsState(reordered);
    },
    [positions]
  );

  return {
    positions,
    setPositions,
    reorderCards,
    isLoaded,
  };
}

export default useCardPositions;
