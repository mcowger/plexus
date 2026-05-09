import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
  X,
  Download,
  Info,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { OpenRouterSlugInput } from '../ui/OpenRouterSlugInput';
import type { Provider } from '../../lib/api';

const KNOWN_APIS = [
  'chat',
  'messages',
  'gemini',
  'embeddings',
  'transcriptions',
  'speech',
  'images',
  'responses',
  'ollama',
];

const getApiBadgeStyle = (apiType: string): React.CSSProperties => {
  switch (apiType.toLowerCase()) {
    case 'messages':
      return { backgroundColor: '#D97757', color: 'white', border: 'none' };
    case 'chat':
      return { backgroundColor: '#ebebeb', color: '#333', border: 'none' };
    case 'gemini':
      return { backgroundColor: '#5084ff', color: 'white', border: 'none' };
    case 'embeddings':
      return { backgroundColor: '#10b981', color: 'white', border: 'none' };
    case 'transcriptions':
      return { backgroundColor: '#a855f7', color: 'white', border: 'none' };
    case 'speech':
      return { backgroundColor: '#f97316', color: 'white', border: 'none' };
    case 'images':
      return { backgroundColor: '#d946ef', color: 'white', border: 'none' };
    case 'responses':
      return { backgroundColor: '#06b6d4', color: 'white', border: 'none' };
    case 'ollama':
      return { backgroundColor: '#1a5f7a', color: 'white', border: 'none' };
    default:
      return {};
  }
};

// ── ModelIdInput (extracted inline component) ──
function ModelIdInput({
  modelId,
  onCommit,
}: {
  modelId: string;
  onCommit: (oldId: string, newId: string) => void;
}) {
  const [draftId, setDraftId] = useState(modelId);
  useEffect(() => {
    setDraftId(modelId);
  }, [modelId]);
  const commit = () => {
    if (!draftId || draftId === modelId) return;
    onCommit(modelId, draftId);
  };
  return (
    <Input
      label="Model ID"
      value={draftId}
      onChange={(e) => setDraftId(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

interface Props {
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  isModelsOpen: boolean;
  setIsModelsOpen: (v: boolean) => void;
  openModelIdx: string | null;
  setOpenModelIdx: (v: string | null) => void;
  isModelExtraBodyOpen: Record<string, boolean>;
  setIsModelExtraBodyOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  testStates: Record<
    string,
    { loading: boolean; result?: 'success' | 'error'; message?: string; showResult: boolean; showMessage?: boolean }
  >;
  onDismissTestMessage: (testKey: string) => void;
  addModel: () => void;
  updateModelId: (oldId: string, newId: string) => void;
  updateModelConfig: (modelId: string, updates: any) => void;
  removeModel: (modelId: string) => void;
  addModelKV: (modelId: string) => void;
  updateModelKV: (modelId: string, oldKey: string, newKey: string, value: any) => void;
  removeModelKV: (modelId: string, key: string) => void;
  onOpenFetchModels: () => void;
  onTestModel: (providerId: string, modelId: string, modelType?: string) => void;
  getApiBaseUrlMap: () => Record<string, string>;
}

export function ProviderModelsEditor({
  editingProvider,
  setEditingProvider: _setEditingProvider,
  isModelsOpen,
  setIsModelsOpen,
  openModelIdx,
  setOpenModelIdx,
  isModelExtraBodyOpen,
  setIsModelExtraBodyOpen,
  testStates,
  addModel,
  updateModelId,
  updateModelConfig,
  removeModel,
  addModelKV,
  updateModelKV,
  removeModelKV,
  onOpenFetchModels,
  onTestModel,
  onDismissTestMessage,
  getApiBaseUrlMap,
}: Props) {
  return (
    <div className="border border-border-glass rounded-md">
      <div
        className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
        onClick={() => setIsModelsOpen(!isModelsOpen)}
      >
        {isModelsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>Provider Models</span>
        <Badge status="connected">{Object.keys(editingProvider.models || {}).length} Models</Badge>
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFetchModels();
          }}
          leftIcon={<Download size={14} />}
          style={{ marginLeft: '8px' }}
        >
          Fetch Models
        </Button>
      </div>
      {isModelsOpen && (
        <div
          style={{
            padding: '8px',
            borderTop: '1px solid var(--color-border-glass)',
            background: 'var(--color-bg-deep)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.entries(editingProvider.models || {}).map(([mId, mCfg]: [string, any]) => {
              const testKey = `${editingProvider.id}-${mId}`;
              const testState = testStates[testKey];

              return (
                <div
                  key={mId}
                  style={{
                    border: '1px solid var(--color-border-glass)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg-surface)',
                  }}
                >
                  <div
                    style={{
                      padding: '6px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setOpenModelIdx(openModelIdx === mId ? null : mId)}
                  >
                    {openModelIdx === mId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span style={{ fontWeight: 600, fontSize: '12px', flex: 1 }}>{mId}</span>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onTestModel(editingProvider.id, mId, mCfg.type);
                      }}
                      className="flex items-center cursor-pointer"
                      title="Test this model"
                    >
                      {testState?.loading ? (
                        <Loader2 size={14} className="animate-spin text-text-secondary" />
                      ) : testState?.showResult && testState.result === 'success' ? (
                        <CheckCircle size={14} className="text-success" />
                      ) : testState?.showResult && testState.result === 'error' ? (
                        <XCircle size={14} className="text-danger" />
                      ) : (
                        <Play size={14} className="text-primary opacity-60" />
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeModel(mId);
                      }}
                      style={{ color: 'var(--color-danger)', padding: '2px' }}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                  {testState?.showMessage && testState.result === 'error' && testState.message && (
                    <div style={{ padding: '0 8px 6px 8px' }}>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismissTestMessage(testKey);
                        }}
                        className="cursor-pointer rounded border border-danger/30 bg-danger/10 px-2 py-1"
                        title="Click to dismiss"
                      >
                        <span className="text-[11px] italic text-danger">{testState.message} [×]</span>
                      </div>
                    </div>
                  )}

                  {openModelIdx === mId && (
                    <div
                      style={{
                        padding: '8px',
                        borderTop: '1px solid var(--color-border-glass)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <ModelIdInput modelId={mId} onCommit={updateModelId} />

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="flex flex-col gap-1">
                          <label className="font-body text-[13px] font-medium text-text-secondary">
                            Model Type
                          </label>
                          <select
                            className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                            value={mCfg.type || 'chat'}
                            onChange={(e) => {
                              const newType = e.target.value as
                                | 'chat'
                                | 'embeddings'
                                | 'transcriptions'
                                | 'speech'
                                | 'image'
                                | 'responses';
                              if (newType === 'embeddings')
                                updateModelConfig(mId, {
                                  type: newType,
                                  access_via: ['embeddings'],
                                });
                              else if (newType === 'transcriptions')
                                updateModelConfig(mId, {
                                  type: newType,
                                  access_via: ['transcriptions'],
                                });
                              else if (newType === 'speech')
                                updateModelConfig(mId, { type: newType, access_via: ['speech'] });
                              else if (newType === 'image')
                                updateModelConfig(mId, { type: newType, access_via: ['images'] });
                              else if (newType === 'responses')
                                updateModelConfig(mId, {
                                  type: newType,
                                  access_via: ['responses'],
                                });
                              else updateModelConfig(mId, { type: newType });
                            }}
                          >
                            <option value="chat">Chat</option>
                            <option value="embeddings">Embeddings</option>
                            <option value="transcriptions">Transcriptions</option>
                            <option value="speech">Speech</option>
                            <option value="image">Image</option>
                            <option value="responses">Responses</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="font-body text-[13px] font-medium text-text-secondary">
                            Pricing Source
                          </label>
                          <select
                            className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                            value={mCfg.pricing?.source || 'simple'}
                            onChange={(e) => {
                              const newSource = e.target.value;
                              let newPricing: any;
                              if (newSource === 'simple')
                                newPricing = {
                                  source: 'simple',
                                  input: mCfg.pricing?.input || 0,
                                  output: mCfg.pricing?.output || 0,
                                  cached: mCfg.pricing?.cached || 0,
                                  cache_write: mCfg.pricing?.cache_write || 0,
                                };
                              else if (newSource === 'openrouter')
                                newPricing = {
                                  source: 'openrouter',
                                  slug: mCfg.pricing?.slug || '',
                                  ...(mCfg.pricing?.discount !== undefined && {
                                    discount: mCfg.pricing.discount,
                                  }),
                                };
                              else if (newSource === 'defined')
                                newPricing = {
                                  source: 'defined',
                                  range: mCfg.pricing?.range || [],
                                };
                              else if (newSource === 'per_request')
                                newPricing = {
                                  source: 'per_request',
                                  amount: mCfg.pricing?.amount || 0,
                                };
                              updateModelConfig(mId, { pricing: newPricing });
                            }}
                          >
                            <option value="simple">Simple</option>
                            <option value="openrouter">OpenRouter</option>
                            <option value="defined">Ranges (Complex)</option>
                            <option value="per_request">Per Request (Flat Fee)</option>
                          </select>
                        </div>
                        {mCfg.type !== 'embeddings' &&
                          mCfg.type !== 'transcriptions' &&
                          mCfg.type !== 'speech' &&
                          mCfg.type !== 'image' &&
                          mCfg.type !== 'responses' && (
                            <div className="flex flex-col gap-1">
                              <label className="font-body text-[13px] font-medium text-text-secondary">
                                Access Via (APIs)
                              </label>
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--color-text-secondary)',
                                  marginBottom: '4px',
                                  lineHeight: '1.4',
                                }}
                              >
                                Choose which API protocols this model should use.
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '6px',
                                  flexWrap: 'wrap',
                                  marginTop: '4px',
                                }}
                              >
                                {KNOWN_APIS.filter((apiType) => {
                                  if (mCfg.type === 'chat')
                                    return [
                                      'messages',
                                      'chat',
                                      'gemini',
                                      'responses',
                                      'ollama',
                                    ].includes(apiType);
                                  return true;
                                }).map((apiType) => {
                                  const isEmbeddingsModel = mCfg.type === 'embeddings';
                                  const isTranscriptionsModel = mCfg.type === 'transcriptions';
                                  const isSpeechModel = mCfg.type === 'speech';
                                  const isImageModel = mCfg.type === 'image';
                                  const isResponsesModel = mCfg.type === 'responses';
                                  const isDisabled =
                                    (isEmbeddingsModel && apiType !== 'embeddings') ||
                                    (isTranscriptionsModel && apiType !== 'transcriptions') ||
                                    (isSpeechModel && apiType !== 'speech') ||
                                    (isImageModel && apiType !== 'images') ||
                                    (isResponsesModel && apiType !== 'responses');
                                  return (
                                    <label
                                      key={apiType}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        fontSize: '11px',
                                        opacity: isDisabled ? 0.4 : 1,
                                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={(mCfg.access_via || []).includes(apiType)}
                                        disabled={isDisabled}
                                        onChange={() => {
                                          const current = mCfg.access_via || [];
                                          const next = current.includes(apiType)
                                            ? current.filter((a: string) => a !== apiType)
                                            : [...current, apiType];
                                          updateModelConfig(mId, { access_via: next });
                                        }}
                                      />
                                      <span
                                        className="inline-flex items-center py-1.5 px-3 rounded-xl text-xs font-medium"
                                        style={{
                                          ...getApiBadgeStyle(apiType),
                                          fontSize: '10px',
                                          padding: '2px 6px',
                                          opacity: (mCfg.access_via || []).includes(apiType)
                                            ? 1
                                            : 0.5,
                                        }}
                                      >
                                        {apiType}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                              {(!mCfg.access_via || mCfg.access_via.length === 0) && (
                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: 'var(--color-text-secondary)',
                                    marginTop: '4px',
                                    fontStyle: 'italic',
                                  }}
                                >
                                  Empty selection — Plexus will use any API type configured for this
                                  provider.
                                </div>
                              )}
                              {(() => {
                                const providerBaseUrlMap = getApiBaseUrlMap();
                                const hasOllamaBaseUrl = Object.entries(providerBaseUrlMap).some(
                                  ([type, url]) => type === 'ollama' && url && url.trim() !== ''
                                );
                                const accessVia = mCfg.access_via || [];
                                if (
                                  hasOllamaBaseUrl &&
                                  !accessVia.includes('ollama') &&
                                  mCfg.type !== 'embeddings' &&
                                  mCfg.type !== 'transcriptions' &&
                                  mCfg.type !== 'speech' &&
                                  mCfg.type !== 'image' &&
                                  mCfg.type !== 'responses'
                                ) {
                                  return (
                                    <div className="flex items-start gap-2 py-1.5 px-2 bg-info/10 border border-info/30 rounded-sm mt-2">
                                      <Info size={14} className="text-info shrink-0 mt-0.5" />
                                      <span className="text-[11px] text-info">
                                        Provider has a native Ollama URL. If you want this model to
                                        use native Ollama, select{' '}
                                        <span style={{ fontWeight: 600 }}>ollama</span> in Access
                                        Via above.
                                      </span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          )}
                      </div>

                      {/* Pricing forms */}
                      {mCfg.pricing?.source === 'simple' && (
                        <div
                          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
                          style={{
                            background: 'var(--color-bg-subtle)',
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          <Input
                            label="Input $/M"
                            type="number"
                            step="0.000001"
                            value={mCfg.pricing.input || 0}
                            onChange={(e) =>
                              updateModelConfig(mId, {
                                pricing: { ...mCfg.pricing, input: parseFloat(e.target.value) },
                              })
                            }
                          />
                          <Input
                            label="Output $/M"
                            type="number"
                            step="0.000001"
                            value={mCfg.pricing.output || 0}
                            onChange={(e) =>
                              updateModelConfig(mId, {
                                pricing: { ...mCfg.pricing, output: parseFloat(e.target.value) },
                              })
                            }
                          />
                          <Input
                            label="Cached $/M"
                            type="number"
                            step="0.000001"
                            value={mCfg.pricing.cached || 0}
                            onChange={(e) =>
                              updateModelConfig(mId, {
                                pricing: { ...mCfg.pricing, cached: parseFloat(e.target.value) },
                              })
                            }
                          />
                          <Input
                            label="Cache Write $/M"
                            type="number"
                            step="0.000001"
                            value={mCfg.pricing.cache_write || 0}
                            onChange={(e) =>
                              updateModelConfig(mId, {
                                pricing: {
                                  ...mCfg.pricing,
                                  cache_write: parseFloat(e.target.value),
                                },
                              })
                            }
                          />
                        </div>
                      )}
                      {mCfg.pricing?.source === 'openrouter' && (
                        <div
                          className="flex flex-col gap-3 sm:flex-row sm:items-end"
                          style={{
                            background: 'var(--color-bg-subtle)',
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <OpenRouterSlugInput
                              label="OpenRouter Model Slug"
                              placeholder="e.g. anthropic/claude-3.5-sonnet"
                              value={mCfg.pricing.slug || ''}
                              onChange={(value) =>
                                updateModelConfig(mId, {
                                  pricing: { ...mCfg.pricing, slug: value },
                                })
                              }
                            />
                          </div>
                          <div className="w-full sm:w-24">
                            <Input
                              label="Discount (0-1)"
                              type="number"
                              step="0.01"
                              min="0"
                              max="1"
                              value={mCfg.pricing.discount ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  const { discount, ...rest } = mCfg.pricing;
                                  updateModelConfig(mId, { pricing: rest });
                                } else
                                  updateModelConfig(mId, {
                                    pricing: { ...mCfg.pricing, discount: parseFloat(val) },
                                  });
                              }}
                            />
                            <span className="text-[10px] text-text-muted">0.1 = 10% off</span>
                          </div>
                        </div>
                      )}
                      {mCfg.pricing?.source === 'defined' && (
                        <div
                          style={{
                            background: 'var(--color-bg-subtle)',
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <label
                              className="font-body text-[13px] font-medium text-text-secondary"
                              style={{ marginBottom: 0 }}
                            >
                              Pricing Ranges
                            </label>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const currentRanges = mCfg.pricing.range || [];
                                updateModelConfig(mId, {
                                  pricing: {
                                    ...mCfg.pricing,
                                    range: [
                                      ...currentRanges,
                                      {
                                        lower_bound: 0,
                                        upper_bound: 0,
                                        input_per_m: 0,
                                        output_per_m: 0,
                                        cache_write_per_m: 0,
                                      },
                                    ],
                                  },
                                });
                              }}
                              leftIcon={<Plus size={14} />}
                            >
                              Add Range
                            </Button>
                          </div>
                          {(mCfg.pricing.range || []).map((range: any, idx: number) => (
                            <div
                              key={idx}
                              style={{
                                border: '1px solid var(--color-border-glass)',
                                padding: '12px',
                                borderRadius: 'var(--radius-sm)',
                                position: 'relative',
                              }}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                style={{
                                  position: 'absolute',
                                  top: '8px',
                                  right: '8px',
                                  color: 'var(--color-danger)',
                                  padding: '4px',
                                }}
                                onClick={() => {
                                  const newRanges = [...mCfg.pricing.range];
                                  newRanges.splice(idx, 1);
                                  updateModelConfig(mId, {
                                    pricing: { ...mCfg.pricing, range: newRanges },
                                  });
                                }}
                              >
                                <X size={14} />
                              </Button>
                              <div
                                className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                                style={{ marginBottom: '8px' }}
                              >
                                <Input
                                  label="Lower Bound"
                                  type="number"
                                  value={range.lower_bound}
                                  onChange={(e) => {
                                    const r = [...mCfg.pricing.range];
                                    r[idx] = { ...range, lower_bound: parseFloat(e.target.value) };
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, range: r },
                                    });
                                  }}
                                />
                                <Input
                                  label="Upper Bound (0 = Infinite)"
                                  type="number"
                                  value={range.upper_bound === Infinity ? 0 : range.upper_bound}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    const r = [...mCfg.pricing.range];
                                    r[idx] = { ...range, upper_bound: val === 0 ? Infinity : val };
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, range: r },
                                    });
                                  }}
                                />
                              </div>
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                <Input
                                  label="Input $/M"
                                  type="number"
                                  step="0.000001"
                                  value={range.input_per_m}
                                  onChange={(e) => {
                                    const r = [...mCfg.pricing.range];
                                    r[idx] = { ...range, input_per_m: parseFloat(e.target.value) };
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, range: r },
                                    });
                                  }}
                                />
                                <Input
                                  label="Output $/M"
                                  type="number"
                                  step="0.000001"
                                  value={range.output_per_m}
                                  onChange={(e) => {
                                    const r = [...mCfg.pricing.range];
                                    r[idx] = { ...range, output_per_m: parseFloat(e.target.value) };
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, range: r },
                                    });
                                  }}
                                />
                                <Input
                                  label="Cached $/M"
                                  type="number"
                                  step="0.000001"
                                  value={range.cached_per_m || 0}
                                  onChange={(e) => {
                                    const r = [...mCfg.pricing.range];
                                    r[idx] = { ...range, cached_per_m: parseFloat(e.target.value) };
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, range: r },
                                    });
                                  }}
                                />
                                <Input
                                  label="Cache Write $/M"
                                  type="number"
                                  step="0.000001"
                                  value={range.cache_write_per_m || 0}
                                  onChange={(e) => {
                                    const nextValue = Number(e.target.value);
                                    const r = [...mCfg.pricing.range];
                                    r[idx] = {
                                      ...range,
                                      cache_write_per_m: Number.isFinite(nextValue) ? nextValue : 0,
                                    };
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, range: r },
                                    });
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                          {(!mCfg.pricing.range || mCfg.pricing.range.length === 0) && (
                            <div className="text-text-muted italic text-center text-sm p-4">
                              No ranges defined. Pricing will likely default to 0.
                            </div>
                          )}
                        </div>
                      )}
                      {mCfg.pricing?.source === 'per_request' && (
                        <div
                          className="grid grid-cols-1 gap-4"
                          style={{
                            background: 'var(--color-bg-subtle)',
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          <Input
                            label="Cost Per Request ($)"
                            type="number"
                            step="0.000001"
                            min="0"
                            value={mCfg.pricing.amount || 0}
                            onChange={(e) =>
                              updateModelConfig(mId, {
                                pricing: {
                                  ...mCfg.pricing,
                                  amount: parseFloat(e.target.value) || 0,
                                },
                              })
                            }
                          />
                          <div
                            className="font-body text-[11px] text-text-secondary"
                            style={{ fontStyle: 'italic' }}
                          >
                            A flat fee charged per API call, regardless of token count.
                          </div>
                        </div>
                      )}

                      {/* Per-Model Extra Body Fields */}
                      <div
                        className="border border-border-glass rounded-md p-3 bg-bg-subtle"
                        style={{ marginTop: '12px' }}
                      >
                        <div
                          className="flex items-center gap-2 cursor-pointer"
                          style={{ minHeight: '38px' }}
                          onClick={() =>
                            setIsModelExtraBodyOpen({
                              ...isModelExtraBodyOpen,
                              [mId]: !isModelExtraBodyOpen[mId],
                            })
                          }
                        >
                          {isModelExtraBodyOpen[mId] ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <label
                            className="font-body text-[13px] font-medium text-text-secondary"
                            style={{ marginBottom: 0, flex: 1, cursor: 'pointer' }}
                          >
                            Extra Body Fields
                          </label>
                          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                            {Object.keys(mCfg.extraBody || {}).length}
                          </Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              addModelKV(mId);
                              setIsModelExtraBodyOpen({ ...isModelExtraBodyOpen, [mId]: true });
                            }}
                          >
                            <Plus size={14} />
                          </Button>
                        </div>
                        {isModelExtraBodyOpen[mId] && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              padding: '8px',
                              borderTop: '1px solid var(--color-border-glass)',
                              background: 'var(--color-bg-deep)',
                            }}
                          >
                            {Object.entries(mCfg.extraBody || {}).length === 0 && (
                              <div className="font-body text-[11px] text-text-secondary italic">
                                No extra body fields configured.
                              </div>
                            )}
                            {Object.entries(mCfg.extraBody || {}).map(
                              ([key, val]: [string, any], idx: number) => (
                                <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                                  <Input
                                    placeholder="Field Name"
                                    value={key}
                                    onChange={(e) => updateModelKV(mId, key, e.target.value, val)}
                                    style={{ flex: 1 }}
                                  />
                                  <Input
                                    placeholder="Value"
                                    value={
                                      typeof val === 'object' ? JSON.stringify(val) : String(val)
                                    }
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      try {
                                        updateModelKV(mId, key, key, JSON.parse(raw));
                                      } catch {
                                        updateModelKV(mId, key, key, raw);
                                      }
                                    }}
                                    style={{ flex: 1 }}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeModelKV(mId, key)}
                                    style={{ padding: '4px' }}
                                  >
                                    <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                                  </Button>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={addModel}>
              Add Model Mapping
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
