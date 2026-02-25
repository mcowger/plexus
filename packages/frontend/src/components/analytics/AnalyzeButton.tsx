/**
 * AnalyzeButton Component
 * ========================
 * Provides deep-dive navigation from Live Metrics cards to Detailed Usage.
 * This component encapsulates the "Analyze" button logic that appears in
 * Live Metrics card modals, allowing users to drill down into detailed
 * analytics with pre-configured filters based on the current card context.
 *
 * Usage:
 *   <AnalyzeButton
 *     cardType="provider"
 *     context={{ provider: "synthetic_new" }}
 *   />
 */

import React from 'react';
import { Button } from '../ui/Button';
import { BarChart3 } from 'lucide-react';

/** Supported card types from Live Metrics that can navigate to Detailed Usage */
export type CardType = 'velocity' | 'provider' | 'model' | 'timeline' | 'modelstack' | 'requests' | 'alerts';

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
  /** Optional click handler - if provided, overrides default navigation behavior */
  onClick?: () => void;
}

/**
 * Build the query string for Detailed Usage based on card type and context.
 * Maps Live Metrics card types to appropriate Detailed Usage configurations.
 */
export const buildAnalyzeQueryString = (cardType: CardType, context?: AnalyzeContext): string => {
  const params = new URLSearchParams();

  // Default to live (5-minute) window for real-time analysis continuity
  params.set('range', context?.timeRange || 'live');

  switch (cardType) {
    case 'provider':
      // Provider card: group by provider, show pie chart breakdown
      params.set('groupBy', 'provider');
      params.set('chartType', 'pie');
      params.set('metric', 'requests');
      if (context?.provider) {
        params.set('filterProvider', context.provider);
      }
      break;

    case 'model':
    case 'modelstack':
      // Model cards: group by model for model performance analysis
      params.set('groupBy', 'model');
      params.set('chartType', 'pie');
      params.set('metric', 'requests');
      if (context?.model) {
        params.set('filterModel', context.model);
      }
      break;

    case 'velocity':
    case 'timeline':
      // Time-series cards: show temporal analysis with velocity
      params.set('groupBy', 'time');
      params.set('chartType', 'composed');
      params.set('metrics', 'requests,velocity,errors');
      break;

    case 'requests':
      // Raw requests card: switch to list view for detailed request inspection
      params.set('groupBy', 'time');
      params.set('viewMode', 'list');
      params.set('chartType', 'bar');
      break;

    case 'alerts':
      // Alerts card: show errors and cooldowns in list view
      params.set('groupBy', 'time');
      params.set('viewMode', 'list');
      params.set('chartType', 'bar');
      params.set('filterStatus', 'error');
      break;

    default:
      // Fallback: time-based grouping with area chart
      params.set('groupBy', 'time');
      params.set('chartType', 'area');
  }

  return params.toString();
};

/**
 * Get human-readable label for the analysis action based on card type.
 * Provides contextual messaging so users understand what they're navigating to.
 */
const getAnalyzeLabel = (cardType: CardType): string => {
  const labels: Record<CardType, string> = {
    velocity: 'Analyze Velocity Trends',
    provider: 'Analyze Provider Performance',
    model: 'Analyze Model Usage',
    modelstack: 'Analyze Model Stack',
    timeline: 'Analyze Timeline',
    requests: 'View Detailed Logs',
    alerts: 'Analyze Alerts'
  };
  return labels[cardType] || 'Analyze in Detail';
};

/**
 * AnalyzeButton - Navigation component for Live Metrics → Detailed Usage drill-down.
 *
 * This component provides a consistent "Analyze" button that appears in
 * Live Metrics card modals. When clicked, it navigates to Detailed Usage
 * with pre-configured filters matching the card's context.
 *
 * Architecture:
 *   - Navigates to Detailed Usage in the current tab by default
 *   - Builds query string via buildQueryString helper
 *   - Maintains 5-minute live window continuity by default
 *   - Supports all 6 Live Metrics card types
 */
export const AnalyzeButton: React.FC<AnalyzeButtonProps> = ({
  cardType,
  context,
  size = 'sm',
  className = '',
  onClick
}) => {
  /**
   * Handle navigation to Detailed Usage.
   * If onClick is provided, use that (e.g., to open modal).
   * Otherwise, navigate to Detailed Usage in the current tab.
   */
  const handleAnalyze = () => {
    if (onClick) {
      onClick();
      return;
    }
    const queryString = buildAnalyzeQueryString(cardType, context);
    const url = `${window.location.origin}/ui/detailed-usage?${queryString}`;
    window.location.assign(url);
  };

  return (
    <Button
      size={size}
      variant="primary"
      onClick={handleAnalyze}
      className={`flex items-center gap-2 ${className}`}
    >
      <BarChart3 size={size === 'sm' ? 14 : 16} />
      {getAnalyzeLabel(cardType)}
    </Button>
  );
};

export default AnalyzeButton;
