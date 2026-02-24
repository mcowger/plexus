import React from 'react';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { Settings2, Zap, Brain, ChevronDown, ChevronRight, Info } from 'lucide-react';

export interface DimensionWeights {
  tokenCount: number;
  codePresence: number;
  reasoningMarkers: number;
  multiStepPatterns: number;
  simpleIndicators: number;
  technicalTerms: number;
  agenticTask: number;
  toolPresence: number;
  questionComplexity: number;
  creativeMarkers: number;
  constraintCount: number;
  outputFormat: number;
  conversationDepth: number;
  imperativeVerbs: number;
  referenceComplexity: number;
  negationComplexity: number;
}

interface TierBoundaries {
  simpleMedium?: number;
  mediumComplex?: number;
  complexReasoning?: number;
}

export interface ClassifierConfig {
  maxTokensForceComplex?: number;
  dimensionWeights?: DimensionWeights;
  tierBoundaries?: TierBoundaries;
  confidenceSteepness?: number;
  ambiguityThreshold?: number;
  ambiguousDefaultTier?: 'HEARTBEAT' | 'SIMPLE' | 'MEDIUM' | 'COMPLEX' | 'REASONING';
  reasoningOverrideMinMatches?: number;
  reasoningOverrideMinConfidence?: number;
  reasoningOverrideMinScore?: number;
  architectureOverrideConfidence?: number;
  architectureOverrideMinScore?: number;
}

export interface TierModels {
  heartbeat: string;
  simple: string;
  medium: string;
  complex: string;
  reasoning: string;
}

export interface AutoRouterConfig {
  enabled: boolean;
  tier_models: TierModels;
  agentic_boost_threshold: number;
  classifier?: ClassifierConfig;
}

interface AutoRouterSettingsProps {
  config: AutoRouterConfig;
  onChange: (config: AutoRouterConfig) => void;
  allModelAliases: string[];
}

const DEFAULT_WEIGHTS: DimensionWeights = {
  tokenCount: 1.0,
  codePresence: 1.0,
  reasoningMarkers: 1.0,
  multiStepPatterns: 1.0,
  simpleIndicators: 1.0,
  technicalTerms: 1.0,
  agenticTask: 1.0,
  toolPresence: 1.0,
  questionComplexity: 1.0,
  creativeMarkers: 1.0,
  constraintCount: 1.0,
  outputFormat: 1.0,
  conversationDepth: 1.0,
  imperativeVerbs: 1.0,
  referenceComplexity: 1.0,
  negationComplexity: 1.0,
};

export const AutoRouterSettings: React.FC<AutoRouterSettingsProps> = ({
  config,
  onChange,
  allModelAliases,
}) => {
  const [classifierExpanded, setClassifierExpanded] = React.useState(false);
  const [weightsExpanded, setWeightsExpanded] = React.useState(false);

  const handleTierChange = (tier: keyof TierModels, value: string) => {
    onChange({
      ...config,
      tier_models: { ...config.tier_models, [tier]: value },
    });
  };

  const handleClassifierChange = (field: keyof ClassifierConfig, value: any) => {
    onChange({
      ...config,
      classifier: { ...config.classifier, [field]: value },
    });
  };

  const handleBoundaryChange = (boundary: keyof TierBoundaries, value: string) => {
    const numValue = value === '' ? undefined : parseFloat(value);
    onChange({
      ...config,
      classifier: {
        ...config.classifier,
        tierBoundaries: { ...config.classifier?.tierBoundaries, [boundary]: numValue },
      },
    });
  };

  const handleWeightChange = (weight: keyof DimensionWeights, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    onChange({
      ...config,
      classifier: {
        ...config.classifier,
        dimensionWeights: {
          ...(config.classifier?.dimensionWeights ?? DEFAULT_WEIGHTS),
          [weight]: numValue,
        },
      },
    });
  };

  const tierKeys: (keyof TierModels)[] = ['heartbeat', 'simple', 'medium', 'complex', 'reasoning'];
  const tierLabels: Record<keyof TierModels, string> = {
    heartbeat: 'Heartbeat',
    simple: 'Simple',
    medium: 'Medium',
    complex: 'Complex',
    reasoning: 'Reasoning',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Settings2 size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="font-heading text-lg font-semibold text-text m-0">Auto Router</h3>
            <p className="text-sm text-text-secondary m-0">
              Automatically route requests to optimal models
            </p>
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onChange={(checked) => onChange({ ...config, enabled: checked })}
        />
      </div>

      {config.enabled && (
        <>
          <div className="border-t border-border-glass pt-4">
            <h4 className="font-heading text-sm font-semibold text-text m-0 mb-3 flex items-center gap-2">
              <Zap size={16} className="text-warning" />
              Tier Model Mappings
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {tierKeys.map((tier) => (
                <div key={tier} className="flex flex-col gap-1">
                  <label className="font-body text-[13px] font-medium text-text-secondary">
                    {tierLabels[tier]}
                  </label>
                  <select
                    value={config.tier_models[tier]}
                    onChange={(e) => handleTierChange(tier, e.target.value)}
                    className="px-3 py-2 bg-bg-deep border border-border-glass rounded-md text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {allModelAliases.map((alias) => (
                      <option key={alias} value={alias}>
                        {alias}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border-glass pt-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-body text-[13px] font-medium text-text-secondary flex items-center gap-2">
                  Agentic Boost Threshold
                  <Info size={12} className="text-text-muted" />
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.agentic_boost_threshold}
                    onChange={(e) =>
                      onChange({ ...config, agentic_boost_threshold: parseFloat(e.target.value) })
                    }
                    className="flex-1 h-2 bg-bg-hover rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={config.agentic_boost_threshold}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        agentic_boost_threshold: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-20 text-center"
                  />
                </div>
                <span className="text-[11px] text-text-muted">
                  Requests with agentic score above this threshold get boosted to higher tier
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-border-glass pt-4">
            <button
              type="button"
              onClick={() => setClassifierExpanded(!classifierExpanded)}
              className="flex items-center gap-2 text-left w-full hover:bg-bg-hover p-2 -mx-2 rounded-md transition-colors"
            >
              {classifierExpanded ? (
                <ChevronDown size={16} className="text-text-muted" />
              ) : (
                <ChevronRight size={16} className="text-text-muted" />
              )}
              <Brain size={16} className="text-info" />
              <span className="font-heading text-sm font-semibold text-text">
                Classifier Settings
              </span>
            </button>

            {classifierExpanded && (
              <div className="mt-3 ml-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="font-body text-[13px] font-medium text-text-secondary">
                      Max Tokens to Force Complex
                    </label>
                    <Input
                      type="number"
                      value={config.classifier?.maxTokensForceComplex ?? ''}
                      onChange={(e) =>
                        handleClassifierChange(
                          'maxTokensForceComplex',
                          e.target.value === '' ? undefined : parseInt(e.target.value)
                        )
                      }
                      placeholder="100000"
                    />
                    <span className="text-[11px] text-text-muted">
                      Requests with more tokens are forced to Complex tier
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-body text-[13px] font-medium text-text-secondary">
                      Confidence Steepness
                    </label>
                    <Input
                      type="number"
                      value={config.classifier?.confidenceSteepness ?? ''}
                      onChange={(e) =>
                        handleClassifierChange(
                          'confidenceSteepness',
                          e.target.value === '' ? undefined : parseFloat(e.target.value)
                        )
                      }
                      placeholder="12"
                    />
                    <span className="text-[11px] text-text-muted">
                      Higher values make classification more decisive
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-body text-[13px] font-medium text-text-secondary">
                      Ambiguity Threshold
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={config.classifier?.ambiguityThreshold ?? ''}
                      onChange={(e) =>
                        handleClassifierChange(
                          'ambiguityThreshold',
                          e.target.value === '' ? undefined : parseFloat(e.target.value)
                        )
                      }
                      placeholder="0.55"
                    />
                    <span className="text-[11px] text-text-muted">
                      Below this confidence, request is considered ambiguous
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-body text-[13px] font-medium text-text-secondary">
                      Ambiguous Default Tier
                    </label>
                    <select
                      value={config.classifier?.ambiguousDefaultTier ?? 'SIMPLE'}
                      onChange={(e) =>
                        handleClassifierChange(
                          'ambiguousDefaultTier',
                          e.target.value as ClassifierConfig['ambiguousDefaultTier']
                        )
                      }
                      className="px-3 py-2 bg-bg-deep border border-border-glass rounded-md text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="HEARTBEAT">Heartbeat</option>
                      <option value="SIMPLE">Simple</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="COMPLEX">Complex</option>
                      <option value="REASONING">Reasoning</option>
                    </select>
                  </div>
                </div>

                <div>
                  <h5 className="font-body text-sm font-semibold text-text m-0 mb-2">
                    Tier Boundaries
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Simple → Medium
                      </label>
                      <Input
                        type="number"
                        step={0.1}
                        value={config.classifier?.tierBoundaries?.simpleMedium ?? ''}
                        onChange={(e) => handleBoundaryChange('simpleMedium', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Medium → Complex
                      </label>
                      <Input
                        type="number"
                        step={0.1}
                        value={config.classifier?.tierBoundaries?.mediumComplex ?? ''}
                        onChange={(e) => handleBoundaryChange('mediumComplex', e.target.value)}
                        placeholder="0.2"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Complex → Reasoning
                      </label>
                      <Input
                        type="number"
                        step={0.1}
                        value={config.classifier?.tierBoundaries?.complexReasoning ?? ''}
                        onChange={(e) => handleBoundaryChange('complexReasoning', e.target.value)}
                        placeholder="0.4"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setWeightsExpanded(!weightsExpanded)}
                    className="flex items-center gap-2 text-left text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {weightsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Dimension Weights ({Object.keys(DEFAULT_WEIGHTS).length} fields)
                  </button>

                  {weightsExpanded && (
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                      {(Object.keys(DEFAULT_WEIGHTS) as (keyof DimensionWeights)[]).map(
                        (weight) => (
                          <div key={weight} className="flex flex-col gap-1">
                            <label className="font-body text-[11px] font-medium text-text-secondary truncate">
                              {weight}
                            </label>
                            <Input
                              type="number"
                              min={0}
                              step={0.1}
                              value={
                                config.classifier?.dimensionWeights?.[weight] ??
                                DEFAULT_WEIGHTS[weight]
                              }
                              onChange={(e) => handleWeightChange(weight, e.target.value)}
                              className="text-xs py-1"
                            />
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-border-glass pt-4">
                  <h5 className="font-body text-sm font-semibold text-text m-0 mb-3">
                    Override Rules
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Reasoning Override - Min Matches
                      </label>
                      <Input
                        type="number"
                        value={config.classifier?.reasoningOverrideMinMatches ?? ''}
                        onChange={(e) =>
                          handleClassifierChange(
                            'reasoningOverrideMinMatches',
                            e.target.value === '' ? undefined : parseInt(e.target.value)
                          )
                        }
                        placeholder="2"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Reasoning Override - Min Confidence
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={config.classifier?.reasoningOverrideMinConfidence ?? ''}
                        onChange={(e) =>
                          handleClassifierChange(
                            'reasoningOverrideMinConfidence',
                            e.target.value === '' ? undefined : parseFloat(e.target.value)
                          )
                        }
                        placeholder="0.7"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Reasoning Override - Min Score
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={config.classifier?.reasoningOverrideMinScore ?? ''}
                        onChange={(e) =>
                          handleClassifierChange(
                            'reasoningOverrideMinScore',
                            e.target.value === '' ? undefined : parseFloat(e.target.value)
                          )
                        }
                        placeholder="0.5"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Architecture Override - Confidence
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={config.classifier?.architectureOverrideConfidence ?? ''}
                        onChange={(e) =>
                          handleClassifierChange(
                            'architectureOverrideConfidence',
                            e.target.value === '' ? undefined : parseFloat(e.target.value)
                          )
                        }
                        placeholder="0.8"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">
                        Architecture Override - Min Score
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={config.classifier?.architectureOverrideMinScore ?? ''}
                        onChange={(e) =>
                          handleClassifierChange(
                            'architectureOverrideMinScore',
                            e.target.value === '' ? undefined : parseFloat(e.target.value)
                          )
                        }
                        placeholder="0.6"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const DEFAULT_AUTO_CONFIG: AutoRouterConfig = {
  enabled: true,
  tier_models: {
    heartbeat: 'small-fast',
    simple: 'claude-haiku-4-5',
    medium: 'kimi-k2.5',
    complex: 'claude-sonnet-4-5',
    reasoning: 'claude-opus-4-5',
  },
  agentic_boost_threshold: 0.8,
  classifier: {
    maxTokensForceComplex: 100000,
    tierBoundaries: {
      simpleMedium: 0,
      mediumComplex: 0.2,
      complexReasoning: 0.4,
    },
    confidenceSteepness: 12,
    ambiguityThreshold: 0.55,
    ambiguousDefaultTier: 'SIMPLE',
  },
};
