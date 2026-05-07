/**
 * AnalyzeButton Component
 * ========================
 * Provides deep-dive navigation from Live Metrics cards to Detailed Usage.
 * This component encapsulates the "Analyze" button logic that appears in
 * Live Metrics card modals, allowing users to drill down into detailed
 * analytics with pre-configured filters based on the current card context.
 *
 * Navigation behavior:
 *   - **Default (no onClick prop):** Opens the Detailed Usage page in a new
 *     browser tab via `window.open()`. The URL includes a query string that
 *     pre-configures the chart type, grouping, metrics, and filters.
 *   - **With onClick prop:** The parent component (e.g., LiveTab) can override
 *     the default behavior by passing an `onClick` handler. LiveTab uses this
 *     to open the DetailedUsage component inside a modal dialog instead of
 *     navigating away. The ExternalLink icon is still rendered for visual
 *     consistency, but the actual behavior is an in-page modal open.
 *
 * Usage:
 *   // Default: opens Detailed Usage in a new browser tab
 *   <AnalyzeButton
 *     cardType="provider"
 *     context={{ provider: "synthetic_new" }}
 *   />
 *
 *   // Modal mode: LiveTab passes onClick to open DetailedUsage in a modal
 *   <AnalyzeButton
 *     cardType="provider"
 *     context={{ provider: "synthetic_new" }}
 *     onClick={() => openDetailedUsageModal("provider", { provider: "synthetic_new" })}
 *   />
 */

import React from 'react';
import { Button } from '../ui/Button';
import { BarChart3, ExternalLink } from 'lucide-react';

/**
 * Supported card types from Live Metrics that can navigate to Detailed Usage.
 *
 * Each value corresponds to a specific Live Metrics dashboard card:
 * - `'velocity'`    - Request velocity card showing requests-per-second trends over time.
 * - `'provider'`    - Provider breakdown card showing distribution across LLM providers.
 * - `'model'`       - Individual model performance card for a single model's stats.
 * - `'timeline'`    - Timeline card showing chronological request activity.
 * - `'modelstack'`  - Stacked model comparison card showing all models together.
 * - `'requests'`    - Raw request count card showing total request volume.
 * - `'concurrency'` - Concurrency/error card showing rate limits and cooldowns.
 */
export type CardType =
  | 'velocity'
  | 'provider'
  | 'model'
  | 'timeline'
  | 'modelstack'
  | 'requests'
  | 'concurrency';

/** Context data passed from Live Metrics cards to pre-configure Detailed Usage */
export interface AnalyzeContext {
  /** Provider name for provider-specific analysis */
  provider?: string;
  /** Model name for model-specific analysis */
  model?: string;
  /** Time range override (defaults to 'live' for 5m window) */
  timeRange?: string;
  /** Group by dimension for the detailed view */
  groupBy?: 'time' | 'provider' | 'model' | 'status';
  /** Initial view mode (chart vs list) */
  viewMode?: 'chart' | 'list';
}

interface AnalyzeButtonProps {
  /** Type of card that triggered the analysis */
  cardType: CardType;
  /** Contextual data for pre-filtering Detailed Usage */
  context?: AnalyzeContext;
  /** Optional button size variant */
  size?: 'sm' | 'md';
  /** Optional additional CSS classes */
  className?: string;
  /**
   * Optional click handler that overrides the default navigation behavior.
   *
   * When NOT provided: clicking the button calls `window.open()` to open
   * the Detailed Usage page in a new browser tab with pre-configured query params.
   *
   * When provided: the handler is called instead, and `window.open()` is skipped
   * entirely. This is used by LiveTab to intercept the click and open
   * DetailedUsage inside a modal dialog, keeping the user on the Live Metrics page.
   * The parent is responsible for calling `buildQueryString()` separately to get
   * the query string and passing it as `initialQueryString` to the embedded
   * DetailedUsage component.
   */
  onClick?: () => void;
}

/**
 * Build the query string for Detailed Usage based on card type and context.
 *
 * This function translates the semantic meaning of each Live Metrics card into
 * the appropriate Detailed Usage URL parameters. The resulting query string
 * pre-configures the DetailedUsage page so the user sees relevant data
 * immediately, without needing to manually adjust filters.
 *
 * The mapping logic ensures continuity between what the user was viewing on
 * the Live Metrics dashboard and what they see in the detailed drill-down:
 *
 * | Card Type       | groupBy    | chartType  | viewMode | Extra Params                |
 * |-----------------|------------|------------|----------|-----------------------------|
 * | `provider`      | provider   | pie        | chart    | filterProvider (if set)     |
 * | `model`         | model      | pie        | chart    | filterModel (if set)        |
 * | `modelstack`    | model      | pie        | chart    | filterModel (if set)        |
 * | `velocity`      | time       | composed   | chart    | metrics=requests,velocity,errors |
 * | `timeline`      | time       | composed   | chart    | metrics=requests,velocity,errors |
 * | `requests`      | time       | bar        | list     | (none)                      |
 * | `concurrency`   | time       | bar        | list     | filterStatus=error          |
 * | (default)       | time       | area       | chart    | (none)                      |
 *
 * @param cardType - The type of Live Metrics card that triggered the drill-down.
 * @param context  - Optional contextual data (provider name, model name, etc.)
 *                   carried from the card to pre-filter the detailed view.
 * @returns A URL-encoded query string (without leading '?') suitable for
 *          appending to the `/ui/detailed-usage` route.
 */
export const buildQueryString = (cardType: CardType, context?: AnalyzeContext): string => {
  const params = new URLSearchParams();

  // Default to live (5-minute) window for real-time analysis continuity.
  // This preserves the temporal context the user was viewing on the Live Metrics dashboard.
  params.set('range', context?.timeRange || 'live');

  switch (cardType) {
    case 'provider':
      // Provider card: group by provider with a pie chart to show the distribution
      // of requests across all LLM providers. If the user clicked into a specific
      // provider's card, filterProvider narrows the view to that provider only.
      params.set('groupBy', 'provider');
      params.set('chartType', 'pie');
      params.set('metric', 'requests');
      if (context?.provider) {
        params.set('filterProvider', context.provider);
      }
      break;

    case 'model':
    case 'modelstack':
      // Model cards (both single-model and stacked): group by model to show
      // per-model breakdown. 'model' is a single model card, 'modelstack' is
      // the stacked comparison. Both use the same drill-down configuration.
      // If a specific model was selected, filterModel narrows the view.
      params.set('groupBy', 'model');
      params.set('chartType', 'pie');
      params.set('metric', 'requests');
      if (context?.model) {
        params.set('filterModel', context.model);
      }
      break;

    case 'velocity':
    case 'timeline':
      // Time-series cards: use a composed chart (bars + lines overlaid) to show
      // requests as bars with velocity and error trends as lines. This gives a
      // rich temporal view that extends what the velocity/timeline cards show.
      params.set('groupBy', 'time');
      params.set('chartType', 'composed');
      params.set('metrics', 'requests,velocity,errors');
      break;

    case 'requests':
      // Raw requests card: switch to list view so users can inspect individual
      // requests. The bar chart type is set as a fallback if the user toggles
      // back to chart view.
      params.set('groupBy', 'time');
      params.set('viewMode', 'list');
      params.set('chartType', 'bar');
      break;

    case 'concurrency':
      // Concurrency card: focus on errors and rate-limit cooldowns by pre-filtering
      // to error status. List view shows individual failed requests for debugging.
      params.set('groupBy', 'time');
      params.set('viewMode', 'list');
      params.set('chartType', 'bar');
      params.set('filterStatus', 'error');
      break;

    default:
      // Fallback for any unknown card type: sensible defaults with time-based
      // grouping and an area chart for general usage visualization.
      params.set('groupBy', 'time');
      params.set('chartType', 'area');
  }

  return params.toString();
};

/**
 * Get human-readable label for the analysis action based on card type.
 * Returns [shortLabel, fullLabel] — the short label is shown on small screens
 * so the button doesn't blow out the card on mobile, and the full descriptive
 * label appears on `sm:` breakpoint and up.
 */
const getAnalyzeLabel = (cardType: CardType): { short: string; full: string } => {
  const labels: Record<CardType, { short: string; full: string }> = {
    velocity: { short: 'Analyze', full: 'Analyze Velocity Trends' },
    provider: { short: 'Analyze', full: 'Analyze Provider Performance' },
    model: { short: 'Analyze', full: 'Analyze Model Usage' },
    modelstack: { short: 'Analyze', full: 'Analyze Model Stack' },
    timeline: { short: 'Analyze', full: 'Analyze Timeline' },
    requests: { short: 'Logs', full: 'View Detailed Logs' },
    concurrency: { short: 'Analyze', full: 'Analyze Concurrency' },
  };
  return labels[cardType] || { short: 'Analyze', full: 'Analyze in Detail' };
};

/**
 * AnalyzeButton - Navigation component for Live Metrics to Detailed Usage drill-down.
 *
 * Renders a styled button with a BarChart3 icon (left) and ExternalLink icon (right).
 * The ExternalLink icon serves as a visual affordance indicating "more detail available."
 * Note: despite the ExternalLink icon, when an `onClick` override is provided (modal mode),
 * clicking does NOT open a new tab -- it triggers the parent's handler instead (typically
 * opening a modal). The icon is kept for visual consistency across both modes.
 *
 * Architecture:
 *   - Builds query string via `buildQueryString` helper based on card type + context
 *   - Default mode: opens `/ui/detailed-usage?{queryString}` in a new tab via `window.open()`
 *   - Modal mode (onClick provided): delegates entirely to the parent's click handler
 *   - Maintains 5-minute live window continuity by default (range=live)
 *   - Supports all 7 Live Metrics card types (see CardType)
 *   - Button label is contextual, e.g., "Analyze Provider Performance" or "View Detailed Logs"
 */
export const AnalyzeButton: React.FC<AnalyzeButtonProps> = ({
  cardType,
  context,
  size = 'sm',
  className = '',
  onClick,
}) => {
  /**
   * Handle navigation to Detailed Usage.
   * If onClick is provided, use that (e.g., to open modal).
   * Otherwise, open Detailed Usage in new tab via window.open().
   */
  const handleAnalyze = () => {
    if (onClick) {
      onClick();
      return;
    }
    const queryString = buildQueryString(cardType, context);
    const url = `${window.location.origin}/ui/detailed-usage?${queryString}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const { short, full } = getAnalyzeLabel(cardType);
  return (
    <Button
      size={size}
      variant="primary"
      onClick={handleAnalyze}
      className={`shrink-0 ${className}`}
    >
      <BarChart3 size={size === 'sm' ? 14 : 16} />
      <span className="xl:hidden">{short}</span>
      <span className="hidden xl:inline">{full}</span>
      <ExternalLink size={size === 'sm' ? 12 : 14} className="hidden sm:block opacity-70" />
    </Button>
  );
};

export default AnalyzeButton;
