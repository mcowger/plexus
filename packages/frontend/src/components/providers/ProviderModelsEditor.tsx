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
import { CopyButton } from '../ui/CopyButton';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { OpenRouterSlugInput } from '../ui/OpenRouterSlugInput';
import type { Provider } from '../../lib/api';
import { KNOWN_ADAPTERS } from './ProviderAdvancedEditor';

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

// Consistent compact field class used everywhere in the model editor
const FIELD_CLS =
  'w-full h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary';

// ── ModelIdInputCompact ──
function ModelIdInputCompact({
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
    <input
      className={FIELD_CLS}
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
    {
      loading: boolean;
      result?: 'success' | 'error';
      message?: string;
      showResult: boolean;
      showMessage?: boolean;
    }
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
  const [modelAdaptersOpen, setModelAdaptersOpen] = useState<Record<string, boolean>>({});
  const [modelAdvancedOpen, setModelAdvancedOpen] = useState<Record<string, boolean>>({});

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
            background: 'var(--color-bg-subtle)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={addModel}>
              Add Model
            </Button>
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
                    <CopyButton
                      value={`direct/${editingProvider.id}/${mId}`}
                      size="sm"
                      className="mr-1"
                    />
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
                        <span className="text-[11px] italic text-danger">
                          {testState.message} [×]
                        </span>
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
                      {/* 2-column primary layout: left = meta, right = pricing */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '8px',
                          alignItems: 'start',
                        }}
                      >
                        {/* Left: Model ID + Type + Access Via */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {/* Compact Model ID — bypasses Input component's py-2 */}
                          <div className="flex flex-col gap-1">
                            <label className="font-body text-[11px] font-medium text-text-secondary">
                              Model ID
                            </label>
                            <ModelIdInputCompact modelId={mId} onCommit={updateModelId} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="font-body text-[11px] font-medium text-text-secondary">
                              Model Type
                            </label>
                            <select
                              className={FIELD_CLS}
                              value={mCfg.type || 'chat'}
                              onChange={(e) => {
                                const newType = e.target.value as
                                  | 'chat'
                                  | 'embeddings'
                                  | 'transcriptions'
                                  | 'speech'
                                  | 'image';
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
                                else updateModelConfig(mId, { type: newType });
                              }}
                            >
                              <option value="chat">Chat</option>
                              <option value="embeddings">Embeddings</option>
                              <option value="transcriptions">Transcriptions</option>
                              <option value="speech">Speech</option>
                              <option value="image">Image</option>
                            </select>
                          </div>

                          {(!mCfg.type || mCfg.type === 'chat') && (
                            <div className="flex flex-col gap-1">
                              <label className="font-body text-[11px] font-medium text-text-secondary">
                                Access Via
                              </label>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(5, auto)',
                                  gap: '4px',
                                  justifyContent: 'start',
                                }}
                              >
                                {['chat', 'messages', 'gemini', 'responses', 'ollama'].map(
                                  (apiType) => (
                                    <label
                                      key={apiType}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={(mCfg.access_via || []).includes(apiType)}
                                        onChange={() => {
                                          const current = mCfg.access_via || [];
                                          const next = current.includes(apiType)
                                            ? current.filter((a: string) => a !== apiType)
                                            : [...current, apiType];
                                          updateModelConfig(mId, { access_via: next });
                                        }}
                                      />
                                      <span
                                        className="inline-flex items-center rounded-xl font-medium"
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
                                  )
                                )}
                              </div>
                              {(!mCfg.access_via || mCfg.access_via.length === 0) && (
                                <span className="font-body text-[11px] text-text-muted italic">
                                  empty = use any provider API
                                </span>
                              )}
                              {(() => {
                                const providerBaseUrlMap = getApiBaseUrlMap();
                                const hasOllamaBaseUrl = Object.entries(providerBaseUrlMap).some(
                                  ([type, url]) => type === 'ollama' && url && url.trim() !== ''
                                );
                                if (
                                  hasOllamaBaseUrl &&
                                  !(mCfg.access_via || []).includes('ollama')
                                ) {
                                  return (
                                    <div className="flex items-start gap-2 py-1.5 px-2 bg-info/10 border border-info/30 rounded-sm">
                                      <Info size={14} className="text-info shrink-0 mt-0.5" />
                                      <span className="text-[11px] text-info">
                                        Provider has a native Ollama URL — select{' '}
                                        <span style={{ fontWeight: 600 }}>ollama</span> above to use
                                        it.
                                      </span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          )}
                        </div>

                        {/* Right: Pricing Source + Pricing Inputs */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div className="flex flex-col gap-1">
                            <label className="font-body text-[11px] font-medium text-text-secondary">
                              Pricing Source
                            </label>
                            <select
                              className={FIELD_CLS}
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

                          {/* Simple pricing */}
                          {mCfg.pricing?.source === 'simple' && (
                            <div
                              className="grid grid-cols-2"
                              style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-sm)',
                                gap: '6px',
                              }}
                            >
                              {[
                                { label: 'Input $/M', key: 'input' },
                                { label: 'Output $/M', key: 'output' },
                                { label: 'Cached $/M', key: 'cached' },
                                { label: 'Cache Write $/M', key: 'cache_write' },
                              ].map(({ label, key }) => (
                                <div key={key} className="flex flex-col gap-0.5">
                                  <label className="font-body text-[11px] font-medium text-text-secondary">
                                    {label}
                                  </label>
                                  <input
                                    className={FIELD_CLS}
                                    type="number"
                                    step="0.000001"
                                    value={(mCfg.pricing as any)[key] || 0}
                                    onChange={(e) =>
                                      updateModelConfig(mId, {
                                        pricing: {
                                          ...mCfg.pricing,
                                          [key]: parseFloat(e.target.value),
                                        },
                                      })
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* OpenRouter pricing */}
                          {mCfg.pricing?.source === 'openrouter' && (
                            <div
                              style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              <div className="flex flex-col gap-0.5">
                                <label className="font-body text-[11px] font-medium text-text-secondary">
                                  OpenRouter Model Slug
                                </label>
                                <OpenRouterSlugInput
                                  placeholder="e.g. anthropic/claude-3.5-sonnet"
                                  value={mCfg.pricing.slug || ''}
                                  onChange={(value) =>
                                    updateModelConfig(mId, {
                                      pricing: { ...mCfg.pricing, slug: value },
                                    })
                                  }
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <label className="font-body text-[11px] font-medium text-text-secondary">
                                  Discount{' '}
                                  <span className="font-normal text-text-muted">
                                    (0.1 = 10% off)
                                  </span>
                                </label>
                                <input
                                  className="w-full py-1 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
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
                              </div>
                            </div>
                          )}

                          {/* Defined/ranges pricing */}
                          {mCfg.pricing?.source === 'defined' && (
                            <div
                              style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <span className="font-body text-[11px] font-medium text-text-secondary">
                                  Pricing Ranges
                                </span>
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
                                    padding: '8px',
                                    borderRadius: 'var(--radius-sm)',
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                  }}
                                >
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    style={{
                                      position: 'absolute',
                                      top: '6px',
                                      right: '6px',
                                      color: 'var(--color-danger)',
                                      padding: '4px',
                                    }}
                                    onClick={() => {
                                      const r = [...mCfg.pricing.range];
                                      r.splice(idx, 1);
                                      updateModelConfig(mId, {
                                        pricing: { ...mCfg.pricing, range: r },
                                      });
                                    }}
                                  >
                                    <X size={14} />
                                  </Button>
                                  <div className="grid grid-cols-2" style={{ gap: '6px' }}>
                                    {[
                                      {
                                        label: 'Lower Bound',
                                        field: 'lower_bound',
                                        val: range.lower_bound,
                                      },
                                      {
                                        label: 'Upper Bound (0=∞)',
                                        field: 'upper_bound',
                                        val: range.upper_bound === Infinity ? 0 : range.upper_bound,
                                      },
                                      {
                                        label: 'Input $/M',
                                        field: 'input_per_m',
                                        val: range.input_per_m,
                                      },
                                      {
                                        label: 'Output $/M',
                                        field: 'output_per_m',
                                        val: range.output_per_m,
                                      },
                                      {
                                        label: 'Cached $/M',
                                        field: 'cached_per_m',
                                        val: range.cached_per_m || 0,
                                      },
                                      {
                                        label: 'Cache Write $/M',
                                        field: 'cache_write_per_m',
                                        val: range.cache_write_per_m || 0,
                                      },
                                    ].map(({ label, field, val }) => (
                                      <div key={field} className="flex flex-col gap-0.5">
                                        <label className="font-body text-[10px] font-medium text-text-secondary">
                                          {label}
                                        </label>
                                        <input
                                          className="w-full py-1 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                                          type="number"
                                          step="0.000001"
                                          value={val}
                                          onChange={(e) => {
                                            const r = [...mCfg.pricing.range];
                                            const v =
                                              field === 'upper_bound'
                                                ? parseFloat(e.target.value) === 0
                                                  ? Infinity
                                                  : parseFloat(e.target.value)
                                                : parseFloat(e.target.value);
                                            r[idx] = {
                                              ...range,
                                              [field]: Number.isFinite(v)
                                                ? v
                                                : field === 'upper_bound'
                                                  ? Infinity
                                                  : 0,
                                            };
                                            updateModelConfig(mId, {
                                              pricing: { ...mCfg.pricing, range: r },
                                            });
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              {(!mCfg.pricing.range || mCfg.pricing.range.length === 0) && (
                                <div className="text-text-muted italic text-center text-[11px] py-2">
                                  No ranges defined.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Per Request pricing */}
                          {mCfg.pricing?.source === 'per_request' && (
                            <div
                              style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              <div className="flex flex-col gap-0.5">
                                <label className="font-body text-[11px] font-medium text-text-secondary">
                                  Cost Per Request ($)
                                </label>
                                <input
                                  className="w-full py-1 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
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
                              </div>
                              <span className="font-body text-[11px] text-text-muted italic">
                                Flat fee per API call, regardless of token count.
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Per-Model Adapters — disclosure */}
                      <div className="border border-border-glass rounded-md overflow-hidden">
                        <div
                          className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
                          onClick={() =>
                            setModelAdaptersOpen((prev) => ({ ...prev, [mId]: !prev[mId] }))
                          }
                        >
                          {modelAdaptersOpen[mId] ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <span className="font-body text-[12px] font-medium text-text-secondary flex-1">
                            Model Adapters
                          </span>
                          {(() => {
                            const modelAdapters: any[] = mCfg.adapter
                              ? Array.isArray(mCfg.adapter)
                                ? mCfg.adapter
                                : [mCfg.adapter]
                              : [];
                            return modelAdapters.length > 0 ? (
                              <Badge
                                status="neutral"
                                style={{ fontSize: '10px', padding: '2px 8px' }}
                              >
                                {modelAdapters.length}
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                        {modelAdaptersOpen[mId] && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: '4px',
                              padding: '8px',
                              borderTop: '1px solid var(--color-border-glass)',
                              background: 'var(--color-bg-subtle)',
                            }}
                          >
                            {KNOWN_ADAPTERS.map((a) => {
                              const modelAdapters: any[] = mCfg.adapter
                                ? Array.isArray(mCfg.adapter)
                                  ? mCfg.adapter
                                  : [mCfg.adapter]
                                : [];
                              const active = modelAdapters.some(
                                (e: any) => (typeof e === 'string' ? e : e.name) === a.value
                              );
                              return (
                                <label
                                  key={a.value}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--color-border-glass)',
                                    background: active
                                      ? 'var(--color-bg-hover)'
                                      : 'var(--color-bg-glass)',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={active}
                                    style={{ marginTop: '2px', flexShrink: 0 }}
                                    onChange={() => {
                                      const modelAdapters: any[] = mCfg.adapter
                                        ? Array.isArray(mCfg.adapter)
                                          ? mCfg.adapter
                                          : [mCfg.adapter]
                                        : [];
                                      const next = active
                                        ? modelAdapters.filter(
                                            (e: any) =>
                                              (typeof e === 'string' ? e : e.name) !== a.value
                                          )
                                        : [
                                            ...modelAdapters,
                                            {
                                              name: a.value,
                                              options:
                                                a.value === 'model_override' ? { rules: [] } : {},
                                            },
                                          ];
                                      updateModelConfig(mId, {
                                        adapter: next.length > 0 ? next : undefined,
                                      });
                                    }}
                                  />
                                  <div>
                                    <div className="font-body text-[12px] font-medium text-text">
                                      {a.label}
                                    </div>
                                    <div
                                      className="font-body text-[11px] text-text-secondary"
                                      style={{ lineHeight: 1.35 }}
                                    >
                                      {a.description}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                            {/* model_override rules editor */}
                            {(() => {
                              const modelAdapters: any[] = mCfg.adapter
                                ? Array.isArray(mCfg.adapter)
                                  ? mCfg.adapter
                                  : [mCfg.adapter]
                                : [];
                              const overrideEntry = modelAdapters.find(
                                (e: any) =>
                                  (typeof e === 'string' ? e : e.name) === 'model_override'
                              );
                              if (!overrideEntry || typeof overrideEntry === 'string') return null;
                              const rules: any[] = overrideEntry.options?.rules ?? [];
                              return (
                                <div
                                  style={{
                                    gridColumn: '1 / -1',
                                    borderTop: '1px solid var(--color-border-glass)',
                                    marginTop: '4px',
                                    paddingTop: '6px',
                                  }}
                                >
                                  <div className="font-body text-[11px] font-medium text-text-secondary mb-1">
                                    Model Override Rules
                                  </div>
                                  <div
                                    className="font-body text-[10px] text-text-muted mb-2"
                                    style={{ lineHeight: 1.3 }}
                                  >
                                    When ANY condition matches, rewrite the model name. Use dotted
                                    paths like reasoning.enabled.
                                  </div>
                                  {rules.map((rule: any, rIdx: number) => (
                                    <div
                                      key={rIdx}
                                      style={{
                                        border: '1px solid var(--color-border-glass)',
                                        borderRadius: 'var(--radius-sm)',
                                        padding: '6px',
                                        marginBottom: '4px',
                                        background: 'var(--color-bg-subtle)',
                                      }}
                                    >
                                      {/* Rewrite rule */}
                                      <div className="font-body text-[10px] font-medium text-text-muted mb-1">
                                        Rewrite
                                      </div>
                                      <div
                                        style={{
                                          display: 'flex',
                                          gap: '4px',
                                          alignItems: 'center',
                                        }}
                                      >
                                        <Input
                                          placeholder="Match model (e.g. deepseek-r1)"
                                          value={rule.model ?? ''}
                                          onChange={(e: any) => {
                                            const updated = [...rules];
                                            updated[rIdx] = {
                                              ...updated[rIdx],
                                              model: e.target.value,
                                            };
                                            const newAdapters = modelAdapters.map((entry: any) =>
                                              typeof entry !== 'string' &&
                                              entry.name === 'model_override'
                                                ? {
                                                    ...entry,
                                                    options: { ...entry.options, rules: updated },
                                                  }
                                                : entry
                                            );
                                            updateModelConfig(mId, { adapter: newAdapters });
                                          }}
                                          style={{ flex: 2 }}
                                        />
                                        <span className="font-body text-[11px] text-text-muted">
                                          →
                                        </span>
                                        <Input
                                          placeholder="Rewrite to (e.g. deepseek-r1-fast)"
                                          value={rule.rewriteTo ?? ''}
                                          onChange={(e: any) => {
                                            const updated = [...rules];
                                            updated[rIdx] = {
                                              ...updated[rIdx],
                                              rewriteTo: e.target.value,
                                            };
                                            const newAdapters = modelAdapters.map((entry: any) =>
                                              typeof entry !== 'string' &&
                                              entry.name === 'model_override'
                                                ? {
                                                    ...entry,
                                                    options: { ...entry.options, rules: updated },
                                                  }
                                                : entry
                                            );
                                            updateModelConfig(mId, { adapter: newAdapters });
                                          }}
                                          style={{ flex: 1 }}
                                        />
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            const updated = rules.filter(
                                              (_: any, i: number) => i !== rIdx
                                            );
                                            const newAdapters = modelAdapters.map((entry: any) =>
                                              typeof entry !== 'string' &&
                                              entry.name === 'model_override'
                                                ? {
                                                    ...entry,
                                                    options: { ...entry.options, rules: updated },
                                                  }
                                                : entry
                                            );
                                            updateModelConfig(mId, { adapter: newAdapters });
                                          }}
                                          style={{ padding: '4px' }}
                                        >
                                          <Trash2
                                            size={14}
                                            style={{ color: 'var(--color-danger)' }}
                                          />
                                        </Button>
                                      </div>
                                      {/* Conditions separator */}
                                      <div
                                        style={{
                                          borderTop: '1px solid var(--color-border-glass)',
                                          margin: '6px 0 4px 0',
                                        }}
                                      />
                                      <div className="font-body text-[10px] font-medium text-text-muted mb-1">
                                        Conditions (any match triggers rewrite)
                                      </div>
                                      {/* Condition column headers */}
                                      <div
                                        style={{
                                          display: 'flex',
                                          gap: '4px',
                                          marginBottom: '2px',
                                          marginLeft: '8px',
                                        }}
                                      >
                                        <span
                                          className="font-body text-[9px] font-medium text-text-muted"
                                          style={{ flex: 1, paddingLeft: '8px' }}
                                        >
                                          Field path (dotted)
                                        </span>
                                        <span
                                          className="font-body text-[9px] font-medium text-text-muted"
                                          style={{ flex: 1, paddingLeft: '8px' }}
                                        >
                                          Value (blank = presence check)
                                        </span>
                                        {/* spacer for delete button column */}
                                        <span style={{ width: '28px' }} />
                                      </div>
                                      {/* Conditions */}
                                      {(rule.conditions ?? []).map((cond: any, cIdx: number) => (
                                        <div
                                          key={cIdx}
                                          style={{
                                            display: 'flex',
                                            gap: '4px',
                                            marginBottom: '2px',
                                            marginLeft: '8px',
                                          }}
                                        >
                                          <Input
                                            placeholder="e.g. reasoning.enabled"
                                            value={cond.field ?? ''}
                                            onChange={(e: any) => {
                                              const updated = [...rules];
                                              const newConditions = [...updated[rIdx].conditions];
                                              newConditions[cIdx] = {
                                                ...newConditions[cIdx],
                                                field: e.target.value,
                                              };
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                conditions: newConditions,
                                              };
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'model_override'
                                                  ? {
                                                      ...entry,
                                                      options: { ...entry.options, rules: updated },
                                                    }
                                                  : entry
                                              );
                                              updateModelConfig(mId, { adapter: newAdapters });
                                            }}
                                            style={{ flex: 1 }}
                                          />
                                          <Input
                                            placeholder="e.g. false, 0, none"
                                            value={
                                              cond.value !== undefined ? String(cond.value) : ''
                                            }
                                            onChange={(e: any) => {
                                              const raw = e.target.value;
                                              const parsed =
                                                raw === ''
                                                  ? undefined
                                                  : raw === 'true'
                                                    ? true
                                                    : raw === 'false'
                                                      ? false
                                                      : isNaN(Number(raw))
                                                        ? raw
                                                        : Number(raw);
                                              const updated = [...rules];
                                              const newConditions = [...updated[rIdx].conditions];
                                              newConditions[cIdx] = {
                                                field: newConditions[cIdx].field,
                                                value: parsed,
                                              };
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                conditions: newConditions,
                                              };
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'model_override'
                                                  ? {
                                                      ...entry,
                                                      options: { ...entry.options, rules: updated },
                                                    }
                                                  : entry
                                              );
                                              updateModelConfig(mId, { adapter: newAdapters });
                                            }}
                                            style={{ flex: 1 }}
                                          />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              const updated = [...rules];
                                              const newConditions = updated[rIdx].conditions.filter(
                                                (_: any, i: number) => i !== cIdx
                                              );
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                conditions: newConditions,
                                              };
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'model_override'
                                                  ? {
                                                      ...entry,
                                                      options: { ...entry.options, rules: updated },
                                                    }
                                                  : entry
                                              );
                                              updateModelConfig(mId, { adapter: newAdapters });
                                            }}
                                            style={{ padding: '4px' }}
                                          >
                                            <Trash2
                                              size={12}
                                              style={{ color: 'var(--color-danger)' }}
                                            />
                                          </Button>
                                        </div>
                                      ))}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          const updated = [...rules];
                                          updated[rIdx] = {
                                            ...updated[rIdx],
                                            conditions: [
                                              ...(updated[rIdx].conditions ?? []),
                                              { field: '' },
                                            ],
                                          };
                                          const newAdapters = modelAdapters.map((entry: any) =>
                                            typeof entry !== 'string' &&
                                            entry.name === 'model_override'
                                              ? {
                                                  ...entry,
                                                  options: { ...entry.options, rules: updated },
                                                }
                                              : entry
                                          );
                                          updateModelConfig(mId, { adapter: newAdapters });
                                        }}
                                        style={{ marginLeft: '8px', padding: '2px 6px' }}
                                      >
                                        <Plus size={12} />{' '}
                                        <span className="font-body text-[10px]">Condition</span>
                                      </Button>
                                    </div>
                                  ))}
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      const newRule = {
                                        model: '',
                                        rewriteTo: '',
                                        conditions: [{ field: '' }],
                                      };
                                      const updated = [...rules, newRule];
                                      const newAdapters = modelAdapters.map((entry: any) =>
                                        typeof entry !== 'string' && entry.name === 'model_override'
                                          ? {
                                              ...entry,
                                              options: { ...entry.options, rules: updated },
                                            }
                                          : entry
                                      );
                                      updateModelConfig(mId, { adapter: newAdapters });
                                    }}
                                    style={{ marginTop: '2px' }}
                                  >
                                    <Plus size={12} />{' '}
                                    <span className="font-body text-[10px]">Rule</span>
                                  </Button>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Per-Model Extra Body Fields */}
                      <div className="border border-border-glass rounded-md overflow-hidden">
                        <div
                          className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
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
                          <span className="font-body text-[12px] font-medium text-text-secondary flex-1">
                            Extra Body Fields
                          </span>
                          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                            {Object.keys(mCfg.extraBody || {}).length}
                          </Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            style={{ padding: '2px 6px', lineHeight: 1 }}
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
                              background: 'var(--color-bg-subtle)',
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

                      {/* Per-Model Advanced */}
                      <div className="border border-border-glass rounded-md overflow-hidden">
                        <div
                          className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
                          onClick={() =>
                            setModelAdvancedOpen((prev) => ({ ...prev, [mId]: !prev[mId] }))
                          }
                        >
                          {modelAdvancedOpen[mId] ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <span className="font-body text-[12px] font-medium text-text-secondary flex-1">
                            Advanced
                          </span>
                          {mCfg.maxConcurrency != null && (
                            <Badge
                              status="neutral"
                              style={{ fontSize: '10px', padding: '2px 8px' }}
                            >
                              Concurrency: {mCfg.maxConcurrency}
                            </Badge>
                          )}
                        </div>
                        {modelAdvancedOpen[mId] && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              padding: '8px',
                              borderTop: '1px solid var(--color-border-glass)',
                              background: 'var(--color-bg-subtle)',
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <label className="font-body text-[11px] font-medium text-text-secondary">
                                Max Concurrency
                                <span className="font-normal text-[10px] text-text-muted ml-1">
                                  this model only
                                </span>
                              </label>
                              <input
                                className={FIELD_CLS}
                                type="number"
                                step="1"
                                min="1"
                                placeholder="No limit"
                                value={mCfg.maxConcurrency != null ? mCfg.maxConcurrency : ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '') {
                                    updateModelConfig(mId, { maxConcurrency: undefined });
                                  } else {
                                    const val = Number(raw);
                                    if (Number.isFinite(val) && val >= 1) {
                                      updateModelConfig(mId, { maxConcurrency: val });
                                    }
                                  }
                                }}
                              />
                              <span className="font-body text-[11px] text-text-muted italic">
                                Limit in-flight requests for this model. Leave empty to use the
                                provider-wide limit or no limit.
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
