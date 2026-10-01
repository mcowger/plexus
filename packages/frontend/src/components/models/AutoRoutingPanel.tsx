import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Info, RotateCcw } from 'lucide-react';
import {
  AUTO_CAPABILITY_TIERS,
  AUTO_TASK_KINDS,
  DEFAULT_AUTO_ROUTING_CONFIG,
} from '@plexus/shared';
import type {
  AutoCapabilityTier,
  AutoRoutingConfig,
  AutoRoutingPreferences,
  AutoRoutingScoring,
  AutoRoutingSwitching,
} from '@plexus/shared';
import type { Alias } from '../../lib/api';
import {
  AUTO_CAPABILITY_LABELS,
  AUTO_TASK_LABELS,
  cloneAutoRoutingConfig,
  createDefaultAutoRoutingConfig,
  hasAutoGroup,
  validateAutoRoutingDraft,
} from '../../lib/autoRouting';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
  /** Decisions model aliases that are authorized and usable as a classifier. */
  decisionsAliases: string[];
}

const CAPABILITY_OPTIONS = [
  { value: '', label: 'Inherit (no floor)' },
  ...AUTO_CAPABILITY_TIERS.map((tier) => ({ value: tier, label: AUTO_CAPABILITY_LABELS[tier] })),
];

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  error,
  hint,
  disabled,
}: NumberFieldProps) {
  return (
    <Input
      type="number"
      label={label}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step ?? 0.01}
      disabled={disabled}
      error={error}
      hint={hint}
      onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
    />
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="font-body text-[12px] font-semibold text-text uppercase tracking-wide">
          {title}
        </div>
        {description && (
          <p className="font-body text-[11px] text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Tier boundary editor with a visual 0–3 score scale. Boundaries are ordered
 * high→low visually; equality advances to the higher tier at selection time.
 */
function TierBoundaryScale({ config }: { config: AutoRoutingConfig }) {
  const { standard, high, premium } = config.scoring.tier_boundaries;
  const clampPct = (value: number) => `${Math.max(0, Math.min(100, (value / 3) * 100))}%`;
  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative h-3 rounded-full overflow-hidden"
        style={{
          background:
            'linear-gradient(90deg, var(--color-bg-glass), var(--color-border-glass) 33%, var(--color-primary) 66%, var(--color-warning))',
        }}
        aria-hidden="true"
      >
        {[
          { key: 'standard', value: standard, label: 'S' },
          { key: 'high', value: high, label: 'H' },
          { key: 'premium', value: premium, label: 'P' },
        ].map((marker) => (
          <span
            key={marker.key}
            className="absolute top-0 h-full w-0.5 bg-white/80"
            style={{ left: clampPct(marker.value) }}
            title={`${marker.label}: ${marker.value}`}
          />
        ))}
      </div>
      <div className="flex justify-between font-body text-[10px] text-text-muted">
        <span>0 (economy)</span>
        <span>1.5</span>
        <span>3 (premium)</span>
      </div>
    </div>
  );
}

export function AutoRoutingPanel({ editingAlias, setEditingAlias, decisionsAliases }: Props) {
  const [isOpen, setIsOpen] = useState(
    () => hasAutoGroup(editingAlias) && editingAlias.auto_routing?.mode === 'active'
  );

  const config = editingAlias.auto_routing ?? createDefaultAutoRoutingConfig();
  const validation = useMemo(
    () => validateAutoRoutingDraft(editingAlias, { decisionsAliases }),
    [editingAlias, decisionsAliases]
  );
  const hasOrdinaryGroup = useMemo(
    () => (editingAlias.target_groups ?? []).some((group) => group.selector !== 'auto'),
    [editingAlias.target_groups]
  );

  if (!hasAutoGroup(editingAlias)) return null;

  const setConfig = (next: AutoRoutingConfig) => {
    setEditingAlias((prev) => ({ ...prev, auto_routing: next }));
  };
  const patchConfig = (patch: Partial<AutoRoutingConfig>) => setConfig({ ...config, ...patch });
  const patchScoring = (patch: Partial<AutoRoutingScoring>) =>
    setConfig({ ...config, scoring: { ...config.scoring, ...patch } });
  const patchPreferences = (patch: Partial<AutoRoutingPreferences>) =>
    setConfig({ ...config, preferences: { ...config.preferences, ...patch } });
  const patchSwitching = (patch: Partial<AutoRoutingSwitching>) =>
    setConfig({ ...config, switching: { ...config.switching, ...patch } });

  const classifierOptions = useMemo(() => {
    const options = decisionsAliases.map((alias) => ({ value: alias, label: alias }));
    if (config.classifier_alias && !decisionsAliases.includes(config.classifier_alias)) {
      options.unshift({
        value: config.classifier_alias,
        label: `${config.classifier_alias} (unavailable)`,
      });
    }
    return options;
  }, [decisionsAliases, config.classifier_alias]);

  const showActivationBlockers =
    config.mode === 'active' && validation.activationBlockers.length > 0;

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <span className="font-body text-[13px] font-medium text-text-secondary">
          Auto Routing
          {config.mode === 'active' && (
            <span className="ml-2 font-body text-[11px] font-normal text-primary">Active</span>
          )}
        </span>
        {isOpen ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </button>

      {isOpen && (
        <div className="px-3 py-3 border-t border-border-glass flex flex-col gap-4">
          <p className="font-body text-[11px] text-text-muted">
            Alias-scoped scoring and switching policy shared by this alias&apos;s auto groups.
            Minimum capability governs normal selection; switching margins never block a required
            upgrade. When no eligible target meets the inferred requirement, the first eligible
            configured option is selected with the unmet qualification disclosed.
          </p>

          {hasOrdinaryGroup && (
            <div
              className="flex items-start gap-2 rounded-sm border px-2 py-1.5 font-body text-[11px]"
              style={{
                borderColor: 'var(--color-warning)',
                color: 'var(--color-warning)',
              }}
            >
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                This alias also has non-auto target groups. Those fallback groups are not
                quality-qualified by auto and are not guaranteed to meet the inferred capability
                requirement.
              </span>
            </div>
          )}

          <Section
            title="Mode & Classifier"
            description="Off uses baseline ordering with no classification."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Mode"
                value={config.mode}
                onChange={(value) => patchConfig({ mode: value as AutoRoutingConfig['mode'] })}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'active', label: 'Active' },
                ]}
              />
              <Select
                label="Classifier alias (Decisions)"
                value={config.classifier_alias}
                placeholder="Select a Decisions alias..."
                onChange={(value) => patchConfig({ classifier_alias: value })}
                options={classifierOptions}
                error={validation.fieldErrors['classifier_alias']}
              />
              <NumberField
                label="Classifier deadline (ms)"
                value={config.classifier_deadline_ms}
                min={1}
                step={1}
                onChange={(value) => patchConfig({ classifier_deadline_ms: value })}
                error={validation.fieldErrors['classifier_deadline_ms']}
              />
              <Select
                label="Baseline policy"
                value={config.baseline_policy}
                onChange={(value) =>
                  patchConfig({ baseline_policy: value as AutoRoutingConfig['baseline_policy'] })
                }
                options={[
                  { value: 'in_order', label: 'In declared order' },
                  { value: 'cost', label: 'Lowest cost (unknown price falls back)' },
                ]}
                error={validation.fieldErrors['baseline_policy']}
              />
              <Select
                label="Uncertainty minimum tier"
                value={config.uncertainty_minimum_tier}
                onChange={(value) =>
                  patchConfig({ uncertainty_minimum_tier: value as AutoCapabilityTier })
                }
                options={AUTO_CAPABILITY_TIERS.map((tier) => ({
                  value: tier,
                  label: AUTO_CAPABILITY_LABELS[tier],
                }))}
                error={validation.fieldErrors['uncertainty_minimum_tier']}
              />
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-xs font-medium text-text-secondary">
                  Rubric version
                </label>
                <div className="h-[27px] flex items-center px-2 font-body text-sm text-text-muted bg-bg-glass border border-border-glass rounded-sm">
                  v{config.rubric_version} (server-shipped)
                </div>
              </div>
            </div>

            {showActivationBlockers && (
              <ul
                className="flex flex-col gap-1 font-body text-[11px] list-disc pl-4"
                style={{ color: 'var(--color-warning)' }}
              >
                {validation.activationBlockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
          </Section>

          <div className="h-px bg-border-glass" />

          <Section
            title="Scoring"
            description="Complexity/capability weights and tier boundaries. Values are provisional defaults."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <NumberField
                label="Complexity weight"
                value={config.scoring.complexity_weight}
                min={0}
                max={1}
                onChange={(value) => patchScoring({ complexity_weight: value })}
                error={validation.fieldErrors['scoring.complexity_weight']}
              />
              <NumberField
                label="Capability weight"
                value={config.scoring.capability_weight}
                min={0}
                max={1}
                onChange={(value) => patchScoring({ capability_weight: value })}
                error={validation.fieldErrors['scoring.capability_weight']}
                hint={`Sum: ${
                  Number.isFinite(config.scoring.complexity_weight) &&
                  Number.isFinite(config.scoring.capability_weight)
                    ? (config.scoring.complexity_weight + config.scoring.capability_weight).toFixed(
                        2
                      )
                    : '—'
                }`}
              />
              <NumberField
                label="Confidence threshold"
                value={config.scoring.confidence_threshold}
                min={0}
                max={1}
                onChange={(value) => patchScoring({ confidence_threshold: value })}
                error={validation.fieldErrors['scoring.confidence_threshold']}
                hint="Policy caution trigger, not a probability guarantee"
              />
              <NumberField
                label="Deep-reasoning threshold"
                value={config.scoring.reasoning_threshold}
                min={0}
                max={1}
                onChange={(value) => patchScoring({ reasoning_threshold: value })}
                error={validation.fieldErrors['scoring.reasoning_threshold']}
              />
              <NumberField
                label="Deep-reasoning boost"
                value={config.scoring.reasoning_boost}
                min={0}
                max={3}
                onChange={(value) => patchScoring({ reasoning_boost: value })}
                error={validation.fieldErrors['scoring.reasoning_boost']}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="font-body text-xs font-medium text-text-secondary">
                Ordered tier boundaries
              </div>
              <TierBoundaryScale config={config} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <NumberField
                  label="Standard boundary"
                  value={config.scoring.tier_boundaries.standard}
                  min={0}
                  max={3}
                  onChange={(value) =>
                    patchScoring({
                      tier_boundaries: { ...config.scoring.tier_boundaries, standard: value },
                    })
                  }
                  error={validation.fieldErrors['scoring.tier_boundaries.standard']}
                />
                <NumberField
                  label="High boundary"
                  value={config.scoring.tier_boundaries.high}
                  min={0}
                  max={3}
                  onChange={(value) =>
                    patchScoring({
                      tier_boundaries: { ...config.scoring.tier_boundaries, high: value },
                    })
                  }
                  error={validation.fieldErrors['scoring.tier_boundaries.high']}
                />
                <NumberField
                  label="Premium boundary"
                  value={config.scoring.tier_boundaries.premium}
                  min={0}
                  max={3}
                  onChange={(value) =>
                    patchScoring({
                      tier_boundaries: { ...config.scoring.tier_boundaries, premium: value },
                    })
                  }
                  error={validation.fieldErrors['scoring.tier_boundaries.premium']}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="font-body text-xs font-medium text-text-secondary">
                Task-specific minimum tiers
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AUTO_TASK_KINDS.map((task) => (
                  <Select
                    key={task}
                    label={AUTO_TASK_LABELS[task] ?? task}
                    value={config.scoring.task_minimum_tiers[task] ?? ''}
                    onChange={(value) => {
                      const next = { ...config.scoring.task_minimum_tiers };
                      if (!value) delete next[task];
                      else next[task] = value as AutoCapabilityTier;
                      patchScoring({ task_minimum_tiers: next });
                    }}
                    options={CAPABILITY_OPTIONS}
                    error={validation.fieldErrors[`scoring.task_minimum_tiers.${task}`]}
                  />
                ))}
              </div>
            </div>
          </Section>

          <div className="h-px bg-border-glass" />

          <Section
            title="Preferences"
            description="Bonuses shape preference among suitable targets; they cannot make an unsuitable target eligible."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberField
                label="Specialty bonus"
                value={config.preferences.specialty_bonus}
                min={0}
                max={1}
                onChange={(value) => patchPreferences({ specialty_bonus: value })}
                error={validation.fieldErrors['preferences.specialty_bonus']}
              />
              <NumberField
                label="Reasoning bonus"
                value={config.preferences.reasoning_bonus}
                min={0}
                max={1}
                onChange={(value) => patchPreferences({ reasoning_bonus: value })}
                error={validation.fieldErrors['preferences.reasoning_bonus']}
              />
            </div>
          </Section>

          <div className="h-px bg-border-glass" />

          <Section
            title="Switching & Cache"
            description="Switch economically only when savings clear both margins and uncertainty bounds separate. Unknown price or warmth never triggers an override."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberField
                label="Score deadband"
                value={config.switching.score_deadband}
                min={0}
                onChange={(value) => patchSwitching({ score_deadband: value })}
                error={validation.fieldErrors['switching.score_deadband']}
                hint="0–3 demand scale"
              />
              <NumberField
                label="Minimum savings (USD)"
                value={config.switching.minimum_savings_usd}
                min={0}
                step={0.001}
                onChange={(value) => patchSwitching({ minimum_savings_usd: value })}
                error={validation.fieldErrors['switching.minimum_savings_usd']}
              />
              <NumberField
                label="Minimum savings fraction"
                value={config.switching.minimum_savings_fraction}
                min={0}
                max={1}
                onChange={(value) => patchSwitching({ minimum_savings_fraction: value })}
                error={validation.fieldErrors['switching.minimum_savings_fraction']}
                hint="0–1"
              />
              <NumberField
                label="Preference-switch margin"
                value={config.switching.preference_margin}
                min={0}
                onChange={(value) => patchSwitching({ preference_margin: value })}
                error={validation.fieldErrors['switching.preference_margin']}
              />
            </div>
          </Section>

          {validation.issues.length > 0 && (
            <div className="flex items-start gap-2 rounded-sm border border-danger px-2 py-1.5 font-body text-[11px] text-danger">
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              <span>Fix the highlighted values before saving. Invalid drafts are never saved.</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<RotateCcw size={13} />}
              onClick={() => setConfig(cloneAutoRoutingConfig(DEFAULT_AUTO_ROUTING_CONFIG))}
            >
              Reset defaults
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
