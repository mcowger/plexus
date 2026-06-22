import { Switch } from '../ui/Switch';
import { Input } from '../ui/Input';
import type { GenerationPolicy, ReasoningEffortLevel, VerbosityLevel } from '../../lib/api';

interface Props {
  value: GenerationPolicy | undefined;
  onChange: (next: GenerationPolicy | undefined) => void;
  /** Short scope label used in the helper text, e.g. "alias" or "key". */
  scope: 'alias' | 'key';
}

// "" represents "model default" (i.e. the field is unset / omitted).
const EFFORT_OPTIONS: Array<{ value: '' | ReasoningEffortLevel; label: string }> = [
  { value: '', label: 'Model default' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
];

// floor/ceiling are magnitude clamps; "off" is not a meaningful bound.
const BOUND_OPTIONS = EFFORT_OPTIONS.filter((o) => o.value !== 'off');

const VERBOSITY_OPTIONS: Array<{ value: '' | VerbosityLevel; label: string }> = [
  { value: '', label: 'Model default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const selectClass =
  'w-full bg-bg-input border border-border-glass rounded-sm px-2 py-1.5 font-body text-[13px] text-text focus:outline-none focus:border-accent';

const fieldLabel = 'font-body text-[11px] text-text-muted';

/** Strip empty objects/strings so we never persist noise; clears policy if empty. */
function prune(policy: GenerationPolicy): GenerationPolicy | undefined {
  const out: GenerationPolicy = {};
  if (policy.reasoning && Object.keys(policy.reasoning).length > 0)
    out.reasoning = policy.reasoning;
  if (policy.maxTokens && Object.keys(policy.maxTokens).length > 0)
    out.maxTokens = policy.maxTokens;
  if (policy.verbosity && Object.keys(policy.verbosity).length > 0)
    out.verbosity = policy.verbosity;
  if (policy.serviceTier && Object.keys(policy.serviceTier).length > 0)
    out.serviceTier = policy.serviceTier;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function GenerationPolicyEditor({ value, onChange, scope }: Props) {
  const policy = value ?? {};
  const reasoning = policy.reasoning ?? {};
  const maxTokens = policy.maxTokens ?? {};
  const verbosity = policy.verbosity ?? {};
  const serviceTier = policy.serviceTier ?? {};

  const patchReasoning = (next: Partial<NonNullable<GenerationPolicy['reasoning']>>) => {
    const merged = { ...reasoning, ...next };
    for (const k of ['default', 'floor', 'ceiling'] as const) {
      if ((merged[k] as string) === '') delete merged[k];
    }
    onChange(prune({ ...policy, reasoning: merged }));
  };

  const patchMaxTokens = (next: Partial<NonNullable<GenerationPolicy['maxTokens']>>) => {
    const merged = { ...maxTokens, ...next };
    for (const k of ['default', 'ceiling'] as const) {
      if (merged[k] == null || Number.isNaN(merged[k])) delete merged[k];
    }
    onChange(prune({ ...policy, maxTokens: merged }));
  };

  const patchVerbosity = (next: Partial<NonNullable<GenerationPolicy['verbosity']>>) => {
    const merged = { ...verbosity, ...next };
    if ((merged.default as string) === '') delete merged.default;
    onChange(prune({ ...policy, verbosity: merged }));
  };

  const patchServiceTier = (next: Partial<NonNullable<GenerationPolicy['serviceTier']>>) => {
    const merged = { ...serviceTier, ...next };
    if (!merged.default) delete merged.default;
    onChange(prune({ ...policy, serviceTier: merged }));
  };

  const parseNum = (raw: string): number | undefined => {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return (
    <div>
      <label
        className="font-body text-[13px] font-medium text-text-secondary"
        style={{ display: 'block', marginBottom: '6px' }}
      >
        Generation Policy
      </label>
      <p className="font-body text-[11px] text-text-muted" style={{ marginBottom: '10px' }}>
        Controls reasoning effort and output parameters for requests routed through this {scope} on
        the beta (pi-ai) inference path. Leave fields as &quot;Model default&quot; / empty to defer
        to the client request and the model&apos;s native behaviour. Resolution order: request
        &rarr; key &rarr; alias &rarr; model default.
      </p>

      {/* ── Reasoning ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        <span className="font-body text-[12px] font-medium text-text-secondary">Reasoning</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Default
            </label>
            <select
              className={selectClass}
              value={reasoning.default ?? ''}
              onChange={(e) => patchReasoning({ default: (e.target.value || undefined) as any })}
            >
              {EFFORT_OPTIONS.map((o) => (
                <option key={o.value || 'default'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Floor (min)
            </label>
            <select
              className={selectClass}
              value={reasoning.floor ?? ''}
              onChange={(e) => patchReasoning({ floor: (e.target.value || undefined) as any })}
            >
              {BOUND_OPTIONS.map((o) => (
                <option key={o.value || 'default'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Ceiling (max)
            </label>
            <select
              className={selectClass}
              value={reasoning.ceiling ?? ''}
              onChange={(e) => patchReasoning({ ceiling: (e.target.value || undefined) as any })}
            >
              {BOUND_OPTIONS.map((o) => (
                <option key={o.value || 'default'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="font-body text-[13px] text-text">Allow client override</span>
            <p className="font-body text-[11px] text-text-muted mt-0.5">
              When off, the client&apos;s requested effort is ignored and the Default above is
              enforced (still subject to floor/ceiling).
            </p>
          </div>
          <Switch
            checked={reasoning.allowClientOverride !== false}
            onChange={(val) => patchReasoning({ allowClientOverride: val ? undefined : false })}
            size="sm"
          />
        </div>
      </div>

      <div className="h-px bg-border-glass" style={{ marginBottom: '12px' }}></div>

      {/* ── Max output tokens ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        <span className="font-body text-[12px] font-medium text-text-secondary">
          Max output tokens
        </span>
        <p className={fieldLabel}>
          Default fills in when the client omits max tokens; Ceiling caps the client&apos;s value.
          Both are further clamped to the model&apos;s physical limit.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Default
            </label>
            <Input
              type="number"
              min={1}
              placeholder="unset"
              value={maxTokens.default ?? ''}
              onChange={(e) => patchMaxTokens({ default: parseNum(e.target.value) })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Ceiling
            </label>
            <Input
              type="number"
              min={1}
              placeholder="unset"
              value={maxTokens.ceiling ?? ''}
              onChange={(e) => patchMaxTokens({ ceiling: parseNum(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-border-glass" style={{ marginBottom: '12px' }}></div>

      {/* ── Verbosity & Service tier (OpenAI-family) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span className="font-body text-[12px] font-medium text-text-secondary">
          Verbosity &amp; service tier
        </span>
        <p className={fieldLabel}>Applied to OpenAI-family models only; ignored by others.</p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Verbosity default
            </label>
            <select
              className={selectClass}
              value={verbosity.default ?? ''}
              onChange={(e) => patchVerbosity({ default: (e.target.value || undefined) as any })}
            >
              {VERBOSITY_OPTIONS.map((o) => (
                <option key={o.value || 'default'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className={fieldLabel} style={{ display: 'block' }}>
              Service tier default
            </label>
            <Input
              placeholder="e.g. auto, flex, priority"
              value={serviceTier.default ?? ''}
              onChange={(e) => patchServiceTier({ default: e.target.value || undefined })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
