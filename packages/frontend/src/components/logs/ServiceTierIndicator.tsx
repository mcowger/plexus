import {
  ArrowRight,
  CircleDot,
  Gauge,
  Rabbit,
  Rocket,
  Turtle,
  type LucideIcon,
} from 'lucide-react';
import type { DisplayServiceTier, ServiceTierDisplay } from './helpers';

const TIER_ICONS: Record<DisplayServiceTier, LucideIcon> = {
  flex: Turtle,
  priority: Rabbit,
  ultrafast: Rocket,
  default: CircleDot,
  auto: CircleDot,
};

/**
 * Icon-only service tier marker shared by the desktop and mobile log rows.
 * A differing actual tier is shown after the requested tier with an arrow.
 */
export const ServiceTierIndicator = ({
  display,
  size = 12,
}: {
  display: ServiceTierDisplay;
  size?: number;
}) => {
  const TierIcon = TIER_ICONS[display.tier];
  const ActualTierIcon = display.actualTier ? TIER_ICONS[display.actualTier] : null;
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      role="img"
      aria-label={display.label}
      title={display.tooltip}
    >
      <Gauge size={size} className="shrink-0 text-text-muted" aria-hidden="true" />
      <TierIcon size={size} className="shrink-0 text-cyan-400" aria-hidden="true" />
      {ActualTierIcon && (
        <>
          <ArrowRight size={size} className="shrink-0 text-text-muted" aria-hidden="true" />
          <ActualTierIcon size={size} className="shrink-0 text-cyan-400" aria-hidden="true" />
        </>
      )}
    </span>
  );
};
