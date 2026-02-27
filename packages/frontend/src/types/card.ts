/**
 * @file Card type definitions for the draggable card layout system.
 *
 * This file is the **single source of truth** for card identity and default layout
 * on the Live Metrics dashboard. Every card that can appear on the dashboard must
 * have its ID listed in the `CardId` union type, and its default position defined
 * in `DEFAULT_CARD_ORDER`.
 *
 * These types are consumed by:
 *  - `useCardPositions` hook (persistence layer -- reads/writes layout to localStorage)
 *  - `SortableCard` component (rendering layer -- renders each card as a draggable item)
 *  - The Live Metrics dashboard page (orchestration -- passes card IDs to the grid)
 *
 * When adding a new card to the dashboard:
 *  1. Add its ID to the `CardId` union.
 *  2. Add it at the desired position in `DEFAULT_CARD_ORDER`.
 *  3. The validation logic in `useCardPositions` will detect the mismatch with any
 *     stale localStorage data and gracefully fall back to the new default order.
 */

/**
 * Discriminated union of every card ID that can appear on the Live Metrics dashboard.
 *
 * Each value maps 1-to-1 with a specific dashboard card:
 *
 * | ID             | Card description                                              |
 * |----------------|---------------------------------------------------------------|
 * | `velocity`     | Request throughput over time (requests/sec)                   |
 * | `provider`     | Breakdown of traffic by LLM provider (OpenAI, Anthropic, etc) |
 * | `model`        | Breakdown of traffic by model name (gpt-4o, claude-3, etc)   |
 * | `timeline`     | Chronological event timeline / activity feed                  |
 * | `modelstack`   | Stacked area chart showing model usage composition over time  |
 * | `requests`     | Live request log / recent requests table                      |
 * | `concurrency`  | Current in-flight concurrent request gauge                    |
 * | `stats`        | Aggregate statistics summary (totals, averages, p99, etc)     |
 *
 * This type is intentionally a string literal union (not an enum) so that card IDs
 * can be used directly as plain strings in localStorage serialization without needing
 * enum-to-string conversion.
 */
export type CardId =
  | 'velocity'
  | 'provider'
  | 'model'
  | 'timeline'
  | 'modelstack'
  | 'requests'
  | 'concurrency'
  | 'stats';

/**
 * Represents a single card's position within the dashboard layout.
 *
 * @property id    - The unique card identifier (from `CardId`).
 * @property order - Zero-based positional index. Lower values render first (top-left).
 *                   This value is recalculated whenever the user reorders cards via
 *                   drag-and-drop so that indices are always contiguous (0, 1, 2, ...).
 */
export interface CardPosition {
  id: CardId;
  order: number;
}

/**
 * A complete dashboard layout expressed as an array of card positions.
 *
 * Invariants that the persistence layer (`useCardPositions`) maintains:
 *  - The array always contains exactly one entry per `CardId` (no duplicates, no gaps).
 *  - The array is sorted by the `order` field in ascending order.
 *  - `order` values are contiguous integers starting from 0.
 */
export type CardLayout = CardPosition[];

/**
 * The default ordering of cards on a fresh dashboard (no prior localStorage state).
 *
 * This constant serves **two** purposes:
 *
 * 1. **Fallback layout** -- When a user visits the dashboard for the first time (or
 *    after clearing browser storage), this array determines the initial card order.
 *    The position in the array corresponds to the card's visual position on the grid.
 *
 * 2. **Validation reference** -- When loading a saved layout from localStorage, the
 *    `useCardPositions` hook checks that every ID in this array is present in the
 *    saved data AND that the saved data has the same length. This catches two cases:
 *      a. A new card was added to the codebase but is missing from the saved layout.
 *      b. A card was removed from the codebase but still exists in the saved layout.
 *    In either case the hook discards the stale saved layout and falls back to this
 *    default order, ensuring the UI never references a card that does not exist and
 *    never hides a card that should be visible.
 */
export const DEFAULT_CARD_ORDER: CardId[] = [
  'concurrency',
  'velocity',
  'provider',
  'model',
  'stats',
  'timeline',
  'modelstack',
  'requests',
];

/**
 * The key used to persist the user's card layout in `window.localStorage`.
 *
 * The stored value is a JSON-serialized `CardLayout` array. The key is namespaced
 * with the `plexus-` prefix to avoid collisions with other applications that might
 * share the same origin.
 */
export const LAYOUT_STORAGE_KEY = 'plexus-card-layout';
