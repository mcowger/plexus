import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  Info,
  Play,
  RefreshCw,
  Target as TargetIcon,
} from 'lucide-react';
import type { AutoRoutingConfig } from '@plexus/shared';
import type {
  AutoJudgment,
  AutoRoutingPreviewResponse,
  AutoRoutingPreviewScenario,
  AutoRoutingPreviewTarget,
  Alias,
} from '../../lib/api';
import { api } from '../../lib/api';
import { createDefaultAutoRoutingConfig, getAutoJudgmentContextKey } from '../../lib/autoRouting';
import {
  describeLeafReason,
  explainAutoPreview,
  type AutoPreviewTargetAnnotation,
} from '../../lib/autoPreviewExplanation';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';

type Simulation = 'cold' | 'incumbent' | 'unknown';

interface Props {
  editingAlias: Alias;
  providers: Array<{ id: string; name: string }>;
  availableModels: Array<{ id: string; providerId: string; name: string }>;
}

const SOURCE_LABELS: Record<string, string> = {
  fresh: 'Fresh judgment',
  exact_cache: 'Exact judgment cache',
  cache: 'Exact judgment cache',
  continuation: 'Reused continuation judgment',
  unavailable: 'No judgment (baseline)',
};

function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined || !Number.isFinite(cost)) return 'unknown';
  return `$${cost.toFixed(4)}`;
}

function formatJudgment(
  judgment: AutoJudgment | undefined
): Array<{ label: string; value: string }> {
  if (!judgment) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ label, value: String(value) });
  };
  push('Task kind', judgment.task_kind);
  push('Complexity', judgment.complexity);
  push('Capability required', judgment.capability_required);
  push('Deep reasoning', judgment.deep_reasoning);
  push('Confidence', judgment.confidence ?? judgment.task_kind_confidence);
  return rows;
}

function TargetRow({
  target,
  annotation,
}: {
  target: AutoRoutingPreviewTarget;
  annotation?: AutoPreviewTargetAnnotation;
}) {
  const label = target.alias
    ? `alias:${target.alias}`
    : `${target.provider ?? '?'}/${target.model ?? '?'}`;
  const status = target.suitable
    ? 'Suitable'
    : target.eligible === false
      ? 'Ineligible'
      : target.suitable === false
        ? 'Not suitable'
        : undefined;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border-glass px-2 py-1 font-body text-[11px]">
        {target.rank !== undefined && (
          <span className="font-semibold text-text-secondary">#{target.rank}</span>
        )}
        <span className="text-text">{label}</span>
        {annotation?.badgeLabel && (
          <Badge status={annotation.badgeStatus} noDot>
            {annotation.badgeLabel}
          </Badge>
        )}
        {target.profile?.capability && (
          <span className="text-text-muted">cap: {target.profile.capability}</span>
        )}
        {target.requiredTier && (
          <span className="text-text-muted">required: {target.requiredTier}</span>
        )}
        {target.demand !== undefined && (
          <span className="text-text-muted">demand: {Number(target.demand).toFixed(2)}</span>
        )}
        {target.preference != null && Number.isFinite(target.preference) && (
          <span className="text-text-muted">pref: {Number(target.preference).toFixed(2)}</span>
        )}
        {status && (
          <span
            style={{
              color:
                target.suitable === true
                  ? 'var(--color-primary)'
                  : target.eligible === false
                    ? 'var(--color-danger)'
                    : 'var(--color-warning)',
            }}
          >
            {status}
          </span>
        )}
        {target.cacheState && <span className="text-text-muted">cache: {target.cacheState}</span>}
        <span className="text-text-muted">est: {formatCost(target.estimatedCostUsd)}</span>
        {annotation?.reasonText && (
          <span className="text-text-muted italic" title={annotation.reasonCode ?? undefined}>
            {annotation.reasonText}
          </span>
        )}
      </div>
      {!target.alias && target.leaves && target.leaves.length > 0 && (
        <div className="ml-5 flex flex-col gap-0.5 border-l border-border-glass pl-2">
          {target.leaves.map((leaf, leafIdx) => {
            const leafReason = describeLeafReason(leaf.reason);
            return (
              <div
                key={`${leaf.id}-${leafIdx}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-body text-[10px] text-text-muted"
              >
                <span className="font-semibold text-text-secondary">
                  {leaf.rank ?? leafIdx + 1}
                </span>
                <span className="text-text-secondary">
                  {leaf.provider ?? '?'}/{leaf.model ?? '?'}
                </span>
                {leaf.eligible === false ? (
                  <span style={{ color: 'var(--color-danger)' }} title={leaf.reason ?? undefined}>
                    ineligible{leafReason ? `: ${leafReason.text}` : ''}
                  </span>
                ) : (
                  leaf.reason && <span className="italic">{leaf.reason}</span>
                )}
                <span>est: {formatCost(leaf.estimatedCostUsd)}</span>
                {leaf.cacheState && <span>cache: {leaf.cacheState}</span>}
                {leaf.provenance && leaf.provenance.length > 1 && (
                  <span>via {leaf.provenance.join(' \u2192 ')}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Internal routing simulation for the auto policy. Must never dispatch a
 * generation request. A fresh judgment may still call the classifier and costs
 * money; retained judgment handles let administrators tune weights without
 * paying twice.
 */
export function AutoRoutingPreview({ editingAlias, providers, availableModels }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [simulation, setSimulation] = useState<Simulation>('cold');
  const [incumbentProvider, setIncumbentProvider] = useState('');
  const [incumbentModel, setIncumbentModel] = useState('');
  const [inputTokens, setInputTokens] = useState('');
  const [cacheState, setCacheState] = useState<'cold' | 'warm' | 'unknown'>('cold');
  const [result, setResult] = useState<AutoRoutingPreviewResponse | null>(null);
  const [resultConfig, setResultConfig] = useState<AutoRoutingConfig | null>(null);
  const [judgmentHandle, setJudgmentHandle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const config = editingAlias.auto_routing ?? createDefaultAutoRoutingConfig();

  // Explanations always pair the response with the policy snapshot that produced
  // it, so moving sliders after a run cannot rewrite the displayed score.
  const explanation = useMemo(
    () => (result ? explainAutoPreview({ result, resultConfig, currentConfig: config }) : null),
    [result, resultConfig, config]
  );

  // Classifier/rubric/context changes invalidate a retained judgment; scoring
  // changes deliberately do not.
  const contextKey = getAutoJudgmentContextKey({
    prompt,
    classifierAlias: config.classifier_alias,
    rubricVersion: config.rubric_version,
  });
  const contextKeyRef = useRef(contextKey);
  useEffect(() => {
    if (contextKeyRef.current !== contextKey) {
      contextKeyRef.current = contextKey;
      setJudgmentHandle(null);
      setResult(null);
      setResultConfig(null);
    }
  }, [contextKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const incumbentModels = useMemo(
    () =>
      incumbentProvider
        ? availableModels
            .filter((model) => model.providerId === incumbentProvider)
            .map((model) => ({ value: model.id, label: model.name }))
        : [],
    [availableModels, incumbentProvider]
  );

  const buildScenario = (): AutoRoutingPreviewScenario | undefined => {
    if (simulation === 'cold') return { cache_state: 'cold' };
    if (simulation === 'unknown') return { cache_state: 'unknown' };
    const scenario: AutoRoutingPreviewScenario = { cache_state: cacheState };
    if (incumbentProvider && incumbentModel) {
      scenario.incumbent = { provider: incumbentProvider, model: incumbentModel };
    }
    const parsedTokens = Number.parseInt(inputTokens, 10);
    if (Number.isFinite(parsedTokens) && parsedTokens >= 0) scenario.input_tokens = parsedTokens;
    return scenario;
  };

  const run = async (options?: { forceFresh?: boolean }) => {
    if (prompt.trim().length === 0) {
      setError('Enter a sample request before running a preview.');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const configSnapshot = config;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.previewAutoRouting(editingAlias, {
        prompt,
        judgmentHandle: options?.forceFresh ? undefined : (judgmentHandle ?? undefined),
        scenario: buildScenario(),
        signal: controller.signal,
      });
      setResult(response);
      setResultConfig(configSnapshot);
      setJudgmentHandle(response.judgment_handle ?? null);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Auto routing preview failed.');
    } finally {
      if (abortRef.current === controller) {
        setIsLoading(false);
        abortRef.current = null;
      }
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  };

  const wouldSelect = explanation?.wouldSelect ?? null;
  const score = explanation?.score ?? null;

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <span className="font-body text-[13px] font-medium text-text-secondary">
          Test Routing Preview
        </span>
        {isOpen ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </button>

      {isOpen && (
        <div className="px-3 py-3 border-t border-border-glass flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-sm border border-border-glass bg-bg-glass px-2 py-1.5 font-body text-[11px] text-text-muted">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            <span>
              A preview never dispatches a generation request. A fresh judgment may call the
              classifier and incurs classifier cost, which is charged even if it arrives too late to
              affect policy. Unknown cost is shown as unknown, never zero.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="auto-preview-prompt"
              className="font-body text-xs font-medium text-text-secondary"
            >
              Sample request / context
            </label>
            <textarea
              id="auto-preview-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Paste a representative request or conversation excerpt..."
              className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
              label="Simulation"
              value={simulation}
              onChange={(value) => setSimulation(value as Simulation)}
              options={[
                { value: 'cold', label: 'Cold conversation' },
                { value: 'incumbent', label: 'Existing incumbent' },
                { value: 'unknown', label: 'Unknown cache state' },
              ]}
            />
            {simulation === 'incumbent' && (
              <>
                <Select
                  label="Incumbent provider"
                  value={incumbentProvider}
                  placeholder="Provider..."
                  onChange={(value) => {
                    setIncumbentProvider(value);
                    setIncumbentModel('');
                  }}
                  options={providers.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Select
                  label="Incumbent model"
                  value={incumbentModel}
                  placeholder="Model..."
                  onChange={setIncumbentModel}
                  options={incumbentModels}
                  disabled={!incumbentProvider}
                />
                <div className="flex flex-col gap-1.5">
                  <label className="font-body text-xs font-medium text-text-secondary">
                    Context size estimate (tokens)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={inputTokens}
                    onChange={(e) => setInputTokens(e.target.value)}
                    placeholder="e.g. 12000"
                    className="h-[27px] px-2 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  />
                </div>
                <Select
                  label="Assumed cache state"
                  value={cacheState}
                  onChange={(value) => setCacheState(value as 'cold' | 'warm' | 'unknown')}
                  options={[
                    { value: 'cold', label: 'Cold (assumption)' },
                    { value: 'warm', label: 'Warm (assumption)' },
                    { value: 'unknown', label: 'Unknown' },
                  ]}
                />
              </>
            )}
          </div>

          <p className="font-body text-[11px]" style={{ color: 'var(--color-warning)' }}>
            All cache states and incumbent context sizes are simulated assumptions, not measured
            provider cache hits.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              leftIcon={isLoading ? <RefreshCw size={13} /> : <Play size={13} />}
              onClick={() => run()}
              disabled={isLoading}
            >
              {judgmentHandle ? 'Recompute (reuse judgment)' : 'Run preview'}
            </Button>
            {isLoading && (
              <Button size="sm" variant="ghost" leftIcon={<Ban size={13} />} onClick={cancel}>
                Cancel
              </Button>
            )}
            {judgmentHandle && !isLoading && (
              <Button size="sm" variant="ghost" onClick={() => run({ forceFresh: true })}>
                Reclassify
              </Button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-sm border border-danger px-2 py-1.5 font-body text-[11px] text-danger">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-3 border-t border-border-glass pt-3">
              {wouldSelect ? (
                <div
                  className="flex flex-col gap-1 rounded-sm border px-3 py-2"
                  style={{ borderColor: 'var(--color-primary)' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TargetIcon size={14} style={{ color: 'var(--color-primary)' }} />
                    <span
                      className="font-body text-[12px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      Would select
                    </span>
                    <Badge
                      status={
                        wouldSelect.mode === 'chosen' || wouldSelect.mode === 'ordinary'
                          ? 'success'
                          : 'warning'
                      }
                      noDot
                    >
                      {wouldSelect.label}
                    </Badge>
                  </div>
                  <p className="font-body text-[11px] text-text-secondary">{wouldSelect.summary}</p>
                  {!wouldSelect.target.alias && wouldSelect.leaf && (
                    <p className="font-body text-[11px] text-text-muted">
                      Concrete dispatch target: {wouldSelect.leaf.provider ?? '?'}/
                      {wouldSelect.leaf.model ?? '?'}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-sm border border-border-glass px-3 py-2 font-body text-[11px] text-text-muted">
                  No eligible configured target to select from this alias.
                </div>
              )}

              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-body text-[12px] font-semibold text-text uppercase tracking-wide">
                    Analysis Results
                  </span>
                  {result.assumptions && result.assumptions.length > 0 && (
                    <Tooltip
                      position="right"
                      content={
                        <div className="w-[400px] max-w-[75vw] whitespace-normal font-body">
                          <div className="mb-2 font-semibold">Simulation assumptions</div>
                          <ul className="flex flex-col gap-1 list-disc pl-4">
                            {result.assumptions.map((line, assumptionIdx) => (
                              <li key={`${assumptionIdx}-${line}`}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      }
                    >
                      <button
                        type="button"
                        aria-label="Simulation assumptions"
                        className="flex items-center rounded-sm text-text-muted hover:text-text focus-visible:outline focus-visible:outline-primary"
                      >
                        <Info size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-[11px] text-text-secondary">
                  <span>
                    Source: {SOURCE_LABELS[result.analysis.source] ?? result.analysis.source}
                  </span>
                  <span>Latency: {result.analysis.latencyMs}ms</span>
                  <span>Classifier cost: {formatCost(result.analysis.cost)}</span>
                  {result.analysis.reason && <span>Reason: {result.analysis.reason}</span>}
                </div>
                {result.analysis.source === 'unavailable' && (
                  <p className="font-body text-[11px] text-text-muted">
                    No usable judgment: the policy falls back to baseline ordering. Baseline
                    behavior still respects access, quota, and continuation constraints.
                  </p>
                )}
                {formatJudgment(result.analysis.judgment).length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-[11px] text-text">
                    {formatJudgment(result.analysis.judgment).map((row) => (
                      <span key={row.label}>
                        <span className="text-text-muted">{row.label}:</span> {row.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {score && (
                <div className="flex flex-col gap-1">
                  <div className="font-body text-[12px] font-semibold text-text uppercase tracking-wide">
                    Score breakdown
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-[11px] text-text-secondary">
                    <span>
                      Complexity: {score.complexity.toFixed(2)} ×{' '}
                      {score.complexityWeight.toFixed(2)} = {score.complexityTerm.toFixed(3)}
                    </span>
                    <span>
                      Capability: {score.capability.toFixed(2)} ×{' '}
                      {score.capabilityWeight.toFixed(2)} = {score.capabilityTerm.toFixed(3)}
                    </span>
                    <span>
                      Reasoning:{' '}
                      {score.reasoningActive
                        ? `+${score.reasoningBoost.toFixed(2)} (deep reasoning ≥ ${score.reasoningThreshold.toFixed(2)})`
                        : `0.00 (below ${score.reasoningThreshold.toFixed(2)})`}
                    </span>
                    <span className="text-text">Demand: {score.demand.toFixed(2)}</span>
                    <span>Premium threshold: {score.premiumThreshold.toFixed(2)}</span>
                    <span>Scored tier: {score.scoredTier}</span>
                    <span>Required tier: {score.requiredTier}</span>
                    {score.taskFloor && (
                      <span>
                        Task floor ({score.taskKind}): {score.taskFloor}
                      </span>
                    )}
                    <span>
                      Confidence:{' '}
                      {score.confidence === null
                        ? `not reported (threshold ${score.confidenceThreshold.toFixed(2)})`
                        : score.confidenceUncertain
                          ? `${score.confidence.toFixed(2)} < ${score.confidenceThreshold.toFixed(2)} (uncertain)`
                          : score.confidence.toFixed(2)}
                    </span>
                  </div>
                  <p className="font-body text-[11px] text-text-muted">
                    Computed with the auto settings captured when this preview ran.
                  </p>
                </div>
              )}

              {explanation?.staleConfig && (
                <p className="font-body text-[11px]" style={{ color: 'var(--color-warning)' }}>
                  Auto settings changed after this preview ran. Recompute to reflect the edits.
                </p>
              )}

              {result.groups.map((group, groupIdx) => {
                const groupExplanation = explanation?.groups[groupIdx];
                return (
                  <div key={`${group.name}-${groupIdx}`} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-body text-[12px] font-semibold text-text">
                        {group.name}
                      </span>
                      <span
                        className="font-body text-[11px] text-text-muted"
                        title={group.decision}
                      >
                        {groupExplanation?.decisionText ?? group.decision}
                      </span>
                    </div>
                    {groupExplanation?.firstOptionFallbackText && (
                      <p
                        className="font-body text-[11px]"
                        style={{ color: 'var(--color-warning)' }}
                      >
                        {groupExplanation.firstOptionFallbackText}
                      </p>
                    )}
                    <div className="flex flex-col gap-1">
                      {group.targets.map((target, targetIdx) => (
                        <TargetRow
                          key={`${target.id}-${targetIdx}`}
                          target={target}
                          annotation={groupExplanation?.targets[targetIdx]}
                        />
                      ))}
                      {group.targets.length === 0 && (
                        <span className="font-body text-[11px] text-text-muted italic">
                          No eligible targets in this group.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              <p className="font-body text-[11px] text-text-muted">
                Estimated costs and cache states are policy assumptions. Preview results are not
                verified answer-quality guarantees.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
