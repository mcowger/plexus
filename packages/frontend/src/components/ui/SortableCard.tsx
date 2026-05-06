/**
 * @file SortableCard -- A drag-and-drop wrapper around the base `<Card>` component.
 *
 * This component implements the **drag handle isolation pattern**: only a small grip
 * icon on the left edge of the card initiates drag operations. The rest of the card
 * surface remains fully interactive (clicks, buttons, links, inputs, etc.).
 *
 * ## Why drag handle isolation matters
 *
 * In an earlier iteration, the `{...listeners}` and `{...attributes}` props from
 * `useSortable` were spread onto the **outer wrapper div** (the same element that
 * receives `ref={setNodeRef}`). This caused a critical bug: @dnd-kit installs
 * `onPointerDown` / `onKeyDown` handlers via `listeners`, and those handlers call
 * `event.preventDefault()` internally to begin a drag gesture. When those listeners
 * sat on the outer div, **every** pointer-down event inside the card -- including
 * clicks on buttons, links, and the card body itself -- was intercepted by dnd-kit
 * before it could propagate to the intended target. The result was that cards became
 * completely unclickable once drag-and-drop was enabled.
 *
 * The fix is to place `{...listeners}` and `{...attributes}` exclusively on a
 * dedicated drag handle element (the grip icon). This way:
 *  - Pointer events on the grip icon start a drag.
 *  - Pointer events everywhere else on the card behave normally.
 *
 * ## Overlay rendering
 *
 * When a card is actively being dragged, @dnd-kit's `<DragOverlay>` renders a
 * **second** instance of `SortableCard` with `isOverlay={true}`. This overlay copy
 * follows the cursor and is styled with an elevated box-shadow and high z-index to
 * appear "lifted" above the page. Meanwhile, the original card in the grid is
 * rendered at reduced opacity (`isDragging` state) to indicate its origin position.
 *
 * ## CSS transform approach
 *
 * @dnd-kit communicates positional changes via a `transform` object rather than
 * absolute positioning. We convert this to a CSS `transform: translate3d(...)` string
 * using the `CSS.Transform.toString` utility. This keeps animations on the GPU
 * compositor thread, avoiding layout thrashing and delivering smooth 60fps drag
 * animations even with many cards on screen.
 */

import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Card } from './Card';
import { clsx } from 'clsx';

/**
 * Data structure describing a single sortable card's content and behaviour.
 *
 * This is the "view model" that the parent component constructs for each card.
 * The `id` field must match a `CardId` from `types/card.ts` so that the
 * persistence layer can track its position.
 *
 * @property id        - Unique identifier for the card (used as the @dnd-kit sortable ID).
 * @property title     - Optional header text rendered in the Card's title bar.
 * @property extra     - Optional ReactNode rendered in the Card header's right slot
 *                       (typically action buttons or dropdown menus).
 * @property content   - The main body content of the card.
 * @property className - Additional CSS classes forwarded to the inner `<Card>`.
 * @property style     - Inline styles forwarded to the inner `<Card>`.
 * @property onClick   - Click handler for the card body. This works correctly because
 *                       drag listeners are isolated to the grip handle (see file docs).
 * @property position  - Optional numeric position hint (for debugging / data attributes).
 */
export interface SortableCardData {
  id: string;
  title?: string;
  extra?: React.ReactNode;
  content?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  position?: number;
}

/**
 * Props accepted by the `SortableCard` component.
 *
 * @property card      - The card data to render (see `SortableCardData`).
 * @property index     - The card's current index in the sorted array. Used by the
 *                       parent to map between visual position and data position.
 * @property onDragEnd - Optional callback invoked after a drag operation completes.
 *                       Accepts either a single new-position or (oldIndex, newIndex) pair.
 * @property isOverlay - When `true`, this instance is being rendered inside @dnd-kit's
 *                       `<DragOverlay>` as the floating drag preview. The component
 *                       applies elevated shadow and z-index styling in this mode.
 *                       Defaults to `false`.
 */
export interface SortableCardProps {
  card: SortableCardData;
  index: number;
  onDragEnd?: ((newPosition: number) => void) | ((oldIndex: number, newIndex: number) => void);
  isOverlay?: boolean;
}

/**
 * SortableCard -- A wrapper around the base `<Card>` component that adds
 * drag-and-drop reordering capabilities via @dnd-kit.
 *
 * Key architectural decisions:
 *  - **Drag handle isolation**: `listeners` and `attributes` are attached ONLY to
 *    the grip icon, NOT the outer wrapper. See the file-level JSDoc for the full
 *    rationale and the bug this pattern prevents.
 *  - **Hover-reveal grip**: The grip icon is hidden (opacity-0) by default and
 *    fades in on hover, keeping the UI clean when the user is not intending to
 *    reorder cards. It also stays visible while a drag is in progress (`isDragging`).
 *  - **Reduced opacity origin**: While dragging, the card at its original grid
 *    position is rendered at 50% opacity to provide a visual anchor showing where
 *    the card came from and where it will return if the drag is cancelled.
 */
export const SortableCard: React.FC<SortableCardProps> = ({ card, isOverlay = false }) => {
  /** Tracks mouse hover state to show/hide the drag grip icon. */
  const [isHovered, setIsHovered] = useState(false);

  /**
   * @dnd-kit's `useSortable` hook provides everything needed for drag-and-drop:
   *
   * - `attributes`  -- ARIA attributes for accessibility (role, tabIndex, etc.).
   * - `listeners`   -- Pointer/keyboard event handlers that initiate drag gestures.
   *                     CRITICAL: these are spread ONLY on the drag handle div below,
   *                     NOT on the outer wrapper. Placing them on the outer div would
   *                     cause dnd-kit to capture all click events inside the card,
   *                     making buttons, links, and card body clicks non-functional.
   * - `setNodeRef`  -- Ref callback that tells dnd-kit which DOM node represents
   *                     this sortable item (used for measuring and collision detection).
   * - `transform`   -- The current x/y translation applied during drag (or during
   *                     the animated shift when neighbouring items make room).
   * - `transition`  -- CSS transition string for smooth position animations.
   * - `isDragging`  -- `true` while this specific card is the active drag target.
   */
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  /**
   * Inline styles applied to the outer wrapper div.
   *
   * - `transform`  -- Converts dnd-kit's transform object to a CSS `translate3d()`
   *                    string. This keeps movement on the GPU compositor layer for
   *                    smooth, jank-free animation.
   * - `transition` -- dnd-kit provides an appropriate CSS transition string so that
   *                    non-dragged items animate smoothly when they shift position
   *                    to make room for the dragged item.
   * - `opacity`    -- The original card is dimmed to 50% while being dragged so the
   *                    user can see both the drag preview (overlay) and the origin slot.
   * - `boxShadow`  -- Elevated shadow applied only to the overlay (drag preview)
   *                    instance to create a "lifted off the page" visual effect.
   * - `zIndex`     -- High z-index on the overlay ensures the drag preview renders
   *                    above all other dashboard content.
   */
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isOverlay ? '0 10px 30px rgba(0,0,0,0.2)' : 'none',
    zIndex: isOverlay ? 999 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`sortable-card-${card.id}`}
      data-dragging={isDragging ? 'true' : 'false'}
      className={clsx('relative group min-w-0 max-w-full', isDragging && 'opacity-50')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/*
       * ===== DRAG HANDLE =====
       *
       * IMPORTANT: `{...listeners}` and `{...attributes}` are applied ONLY to this
       * inner div, NOT the outer wrapper. This is the core of the drag handle
       * isolation pattern.
       *
       * If these props were on the outer div:
       *  1. dnd-kit's onPointerDown handler would fire on ANY click inside the card.
       *  2. The handler calls event.preventDefault(), blocking native click behaviour.
       *  3. All interactive elements inside the card (buttons, links, onClick handlers
       *     on the Card body) would become non-functional.
       *
       * By scoping listeners to just this small grip icon, only pointer-down events
       * that originate on the grip will start a drag. Everything else works normally.
       *
       * The grip icon visibility is controlled by hover state:
       *  - Hidden (opacity-0) when the card is not hovered -- keeps the UI clean.
       *  - Visible (opacity-100) on hover or while actively dragging -- so the user
       *    can find and use the handle, and it remains visible during the drag.
       *  - The transition-opacity class provides a smooth 200ms fade in/out.
       *
       * Cursor changes:
       *  - `cursor-grab` at rest indicates the element is draggable.
       *  - `active:cursor-grabbing` during a drag indicates the element is being held.
       */}
      <div
        data-testid="drag-handle"
        className={clsx(
          'absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 rounded p-1 cursor-grab transition-opacity duration-200 active:cursor-grabbing md:block',
          isHovered || isDragging ? 'opacity-100' : 'opacity-0'
        )}
        {...listeners}
        {...attributes}
      >
        <GripVertical size={20} className="text-text-secondary" />
      </div>

      {/*
       * ===== CARD CONTENT =====
       *
       * The inner Card component receives all content and interaction props directly.
       * Because drag listeners are NOT on this element's ancestor wrapper (they are
       * only on the grip handle above), all clicks, hovers, and keyboard events inside
       * the Card propagate normally without dnd-kit interference.
       *
       * The `pl-8` (padding-left: 2rem) creates space for the absolutely-positioned
       * grip handle so that card content does not overlap with it.
       */}
      <div data-testid="sortable-card" className="min-w-0 max-w-full md:pl-8">
        <Card
          title={card.title}
          extra={card.extra}
          className={card.className}
          style={card.style}
          onClick={card.onClick}
        >
          {card.content}
        </Card>
      </div>
    </div>
  );
};

/** Display name for React DevTools debugging. */
SortableCard.displayName = 'SortableCard';

export default SortableCard;
