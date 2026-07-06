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
import { DebouncedInput } from '../ui/DebouncedInput';
import type { Provider } from '../../lib/api';
import { api } from '../../lib/api';
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
  isNewProvider: boolean;
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
  isNewProvider,
}: Props) {
  const [modelAdaptersOpen, setModelAdaptersOpen] = useState<Record<string, boolean>>({});
  const [modelAdvancedOpen, setModelAdvancedOpen] = useState<Record<string, boolean>>({});

  // pi-ai model dropdown state — shared across all models (same provider)
  const [piModels, setPiModels] = useState<
    Array<{ id: string; name: string; api: string; custom: boolean }>
  >([]);
  const [piModelCustom, setPiModelCustom] = useState<Record<string, boolean>>({});

  const piAiProvider = editingProvider.pi_ai_provider;

  useEffect(() => {
    if (!piAiProvider) {
      setPiModels([]);
      return;
    }
    api
      .getPiModels(piAiProvider)
      .then(setPiModels)
      .catch(() => setPiModels([]));
  }, [piAiProvider]);

  // When models load, mark any existing model IDs that aren't in the registry as custom
  useEffect(() => {
    if (piModels.length === 0) return;
    const modelIds = new Set(piModels.map((m) => m.id));
    const models = editingProvider.models as Record<string, any> | undefined;
    if (!models) return;
    const updates: Record<string, boolean> = {};
    for (const [mId, mCfg] of Object.entries(models)) {
      const piId = (mCfg as any).pi_ai_model_id;
      if (piId && !modelIds.has(piId)) {
        updates[mId] = true;
      }
    }
    if (Object.keys(updates).length > 0) {
      setPiModelCustom((prev) => ({ ...prev, ...updates }));
    }
  }, [piModels, editingProvider.models]);

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
                        if (isNewProvider) return;
                        e.stopPropagation();
                        onTestModel(editingProvider.id, mId, mCfg.type);
                      }}
                      className={
                        isNewProvider
                          ? 'flex items-center cursor-not-allowed opacity-40'
                          : 'flex items-center cursor-pointer'
                      }
                      title={
                        isNewProvider
                          ? 'Save the provider first to probe models'
                          : 'Test this model'
                      }
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
                        {/* Left: Model ID + Type + Access Via + pi-ai Model ID */}
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
                              value={mCfg.type || 'text'}
                              onChange={(e) => {
                                const newType = e.target.value as
                                  | 'text'
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
                              <option value="text">Text</option>
                              <option value="embeddings">Embeddings</option>
                              <option value="transcriptions">Transcriptions</option>
                              <option value="speech">Speech</option>
                              <option value="image">Image</option>
                            </select>
                          </div>

                          {(!mCfg.type || mCfg.type === 'text') && (
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

                          {/* pi-ai Model ID */}
                          <div className="flex flex-col gap-1">
                            <label className="font-body text-[11px] font-medium text-text-secondary">
                              pi-ai Model ID
                            </label>
                            {piAiProvider && piModels.length > 0 && !piModelCustom[mId] ? (
                              <select
                                className={FIELD_CLS}
                                value={mCfg.pi_ai_model_id ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '__custom__') {
                                    setPiModelCustom((prev) => ({ ...prev, [mId]: true }));
                                    return;
                                  }
                                  updateModelConfig(mId, {
                                    pi_ai_model_id: raw || undefined,
                                  });
                                }}
                              >
                                <option value="">— none —</option>
                                {piModels.map((m) => (
                                  <option
                                    key={m.id}
                                    value={m.id}
                                    title={`${m.api}${m.custom ? ' · custom model' : ''}`}
                                  >
                                    {m.id}
                                    {m.custom ? ' (custom)' : ''}
                                  </option>
                                ))}
                                <option value="__custom__">custom...</option>
                              </select>
                            ) : (
                              <div className="flex gap-1">
                                <input
                                  className={`${FIELD_CLS} flex-1`}
                                  type="text"
                                  placeholder="e.g. gpt-4.1, claude-opus-4-6"
                                  value={mCfg.pi_ai_model_id ?? ''}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    updateModelConfig(mId, {
                                      pi_ai_model_id: raw || undefined,
                                    });
                                  }}
                                  autoFocus={!!piModelCustom[mId]}
                                />
                                {piAiProvider && piModels.length > 0 && piModelCustom[mId] && (
                                  <button
                                    type="button"
                                    className="font-body text-[11px] text-text-muted hover:text-text px-1 flex-shrink-0"
                                    title="Back to list"
                                    onClick={() =>
                                      setPiModelCustom((prev) => ({ ...prev, [mId]: false }))
                                    }
                                  >
                                    ↩
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
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
                                                a.value === 'model_override'
                                                  ? { rules: [] }
                                                  : a.value === 'reasoning_rewrite'
                                                    ? { rules: [] }
                                                    : {},
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
                                        <div
                                          className="font-body text-[12px] text-text-muted"
                                          style={{
                                            flex: 2,
                                            padding: '5px 8px',
                                            background: 'var(--color-bg-glass)',
                                            border: '1px solid var(--color-border-glass)',
                                            borderRadius: 'var(--radius-sm)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                          title={mId}
                                        >
                                          {mId}
                                        </div>
                                        <span className="font-body text-[11px] text-text-muted">
                                          →
                                        </span>
                                        <div style={{ flex: 1 }}>
                                          <DebouncedInput
                                            placeholder="Rewrite to (e.g. deepseek-r1-fast)"
                                            value={rule.rewriteTo ?? ''}
                                            onChange={(val: string) => {
                                              const updated = [...rules];
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                rewriteTo: val,
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
                                          />
                                        </div>
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
                                          <div style={{ flex: 2 }}>
                                            <DebouncedInput
                                              placeholder="e.g. reasoning.enabled"
                                              value={cond.field ?? ''}
                                              onChange={(val: string) => {
                                                const updated = [...rules];
                                                const newConditions = [...updated[rIdx].conditions];
                                                newConditions[cIdx] = {
                                                  ...newConditions[cIdx],
                                                  field: val,
                                                };
                                                updated[rIdx] = {
                                                  ...updated[rIdx],
                                                  conditions: newConditions,
                                                };
                                                const newAdapters = modelAdapters.map(
                                                  (entry: any) =>
                                                    typeof entry !== 'string' &&
                                                    entry.name === 'model_override'
                                                      ? {
                                                          ...entry,
                                                          options: {
                                                            ...entry.options,
                                                            rules: updated,
                                                          },
                                                        }
                                                      : entry
                                                );
                                                updateModelConfig(mId, { adapter: newAdapters });
                                              }}
                                            />
                                          </div>
                                          <div style={{ flex: 1 }}>
                                            <DebouncedInput
                                              placeholder="e.g. false, 0, none"
                                              value={
                                                cond.value !== undefined ? String(cond.value) : ''
                                              }
                                              onChange={(val: string) => {
                                                const parsed =
                                                  val === ''
                                                    ? undefined
                                                    : val === 'true'
                                                      ? true
                                                      : val === 'false'
                                                        ? false
                                                        : isNaN(Number(val))
                                                          ? val
                                                          : Number(val);
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
                                                const newAdapters = modelAdapters.map(
                                                  (entry: any) =>
                                                    typeof entry !== 'string' &&
                                                    entry.name === 'model_override'
                                                      ? {
                                                          ...entry,
                                                          options: {
                                                            ...entry.options,
                                                            rules: updated,
                                                          },
                                                        }
                                                      : entry
                                                );
                                                updateModelConfig(mId, { adapter: newAdapters });
                                              }}
                                            />
                                          </div>
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
                                        model: mId,
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
                            {/* reasoning_rewrite rules editor */}
                            {(() => {
                              const modelAdapters: any[] = mCfg.adapter
                                ? Array.isArray(mCfg.adapter)
                                  ? mCfg.adapter
                                  : [mCfg.adapter]
                                : [];
                              const rewriteEntry = modelAdapters.find(
                                (e: any) =>
                                  (typeof e === 'string' ? e : e.name) === 'reasoning_rewrite'
                              );
                              if (!rewriteEntry || typeof rewriteEntry === 'string') return null;
                              const rules: any[] = rewriteEntry.options?.rules ?? [];
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
                                    Reasoning Rewrite Rules
                                  </div>
                                  <div
                                    className="font-body text-[10px] text-text-muted mb-2"
                                    style={{ lineHeight: 1.3 }}
                                  >
                                    Map unified reasoning fields to provider-specific formats. Each
                                    rule reads a source field and writes one or more targets.
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
                                      {/* Source + When condition */}
                                      <div
                                        style={{
                                          display: 'flex',
                                          gap: '4px',
                                          alignItems: 'center',
                                          marginBottom: '4px',
                                        }}
                                      >
                                        <div style={{ flex: 2 }}>
                                          <DebouncedInput
                                            placeholder="Source (e.g. reasoning.enabled)"
                                            value={rule.source ?? ''}
                                            onChange={(val: string) => {
                                              const updated = [...rules];
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                source: val,
                                              };
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'reasoning_rewrite'
                                                  ? {
                                                      ...entry,
                                                      options: { ...entry.options, rules: updated },
                                                    }
                                                  : entry
                                              );
                                              updateModelConfig(mId, { adapter: newAdapters });
                                            }}
                                          />
                                        </div>
                                        {/* When operator */}
                                        <div style={{ flex: 0.7 }}>
                                          <select
                                            className="w-full py-1 pl-2 pr-2 font-body text-[11px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                                            value={rule.when?.op ?? ''}
                                            onChange={(e) => {
                                              const op = e.target.value;
                                              const updated = [...rules];
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                when: op ? { op } : undefined,
                                              };
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'reasoning_rewrite'
                                                  ? {
                                                      ...entry,
                                                      options: { ...entry.options, rules: updated },
                                                    }
                                                  : entry
                                              );
                                              updateModelConfig(mId, { adapter: newAdapters });
                                            }}
                                          >
                                            <option value="">Any (present)</option>
                                            <option value="eq">Equals</option>
                                            <option value="neq">Not equals</option>
                                            <option value="gt">Greater than</option>
                                            <option value="gte">≥</option>
                                            <option value="lt">Less than</option>
                                            <option value="lte">≤</option>
                                            <option value="in">In list</option>
                                            <option value="present">Present</option>
                                            <option value="absent">Absent</option>
                                          </select>
                                        </div>
                                        {/* When value */}
                                        <div style={{ flex: 1 }}>
                                          <DebouncedInput
                                            placeholder="Value"
                                            value={
                                              rule.when?.value != null
                                                ? String(rule.when.value)
                                                : rule.when?.values
                                                  ? rule.when.values.join(',')
                                                  : ''
                                            }
                                            onChange={(val: string) => {
                                              const updated = [...rules];
                                              const currentWhen = updated[rIdx].when || {};
                                              if (currentWhen.op === 'in') {
                                                updated[rIdx] = {
                                                  ...updated[rIdx],
                                                  when: {
                                                    ...currentWhen,
                                                    values: val
                                                      .split(',')
                                                      .map((s: string) => s.trim())
                                                      .filter(Boolean),
                                                  },
                                                };
                                              } else {
                                                const parsed =
                                                  val === ''
                                                    ? undefined
                                                    : val === 'true'
                                                      ? true
                                                      : val === 'false'
                                                        ? false
                                                        : isNaN(Number(val))
                                                          ? val
                                                          : Number(val);
                                                updated[rIdx] = {
                                                  ...updated[rIdx],
                                                  when: { ...currentWhen, value: parsed },
                                                };
                                              }
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'reasoning_rewrite'
                                                  ? {
                                                      ...entry,
                                                      options: { ...entry.options, rules: updated },
                                                    }
                                                  : entry
                                              );
                                              updateModelConfig(mId, { adapter: newAdapters });
                                            }}
                                          />
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            const updated = rules.filter(
                                              (_: any, i: number) => i !== rIdx
                                            );
                                            const newAdapters = modelAdapters.map((entry: any) =>
                                              typeof entry !== 'string' &&
                                              entry.name === 'reasoning_rewrite'
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
                                      {/* Rewrites */}
                                      <div className="font-body text-[10px] font-medium text-text-muted mb-1">
                                        Rewrites
                                      </div>
                                      {(rule.rewrites ?? []).map((rw: any, rwIdx: number) => (
                                        <div
                                          key={rwIdx}
                                          style={{
                                            display: 'flex',
                                            gap: '4px',
                                            alignItems: 'center',
                                            marginBottom: '2px',
                                            marginLeft: '8px',
                                          }}
                                        >
                                          <div style={{ flex: 2 }}>
                                            <DebouncedInput
                                              placeholder="Target path (e.g. enable_thinking)"
                                              value={rw.target ?? ''}
                                              onChange={(val: string) => {
                                                const updated = [...rules];
                                                const newRewrites = [...updated[rIdx].rewrites];
                                                newRewrites[rwIdx] = {
                                                  ...newRewrites[rwIdx],
                                                  target: val,
                                                };
                                                updated[rIdx] = {
                                                  ...updated[rIdx],
                                                  rewrites: newRewrites,
                                                };
                                                const newAdapters = modelAdapters.map(
                                                  (entry: any) =>
                                                    typeof entry !== 'string' &&
                                                    entry.name === 'reasoning_rewrite'
                                                      ? {
                                                          ...entry,
                                                          options: {
                                                            ...entry.options,
                                                            rules: updated,
                                                          },
                                                        }
                                                      : entry
                                                );
                                                updateModelConfig(mId, { adapter: newAdapters });
                                              }}
                                            />
                                          </div>
                                          {/* Value type selector */}
                                          <div style={{ flex: 0.7 }}>
                                            <select
                                              className="w-full py-1 pl-2 pr-2 font-body text-[11px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                                              value={
                                                rw.value === null
                                                  ? 'null'
                                                  : rw.value === undefined
                                                    ? ''
                                                    : typeof rw.value !== 'object'
                                                      ? 'literal'
                                                      : rw.value.from === 'source'
                                                        ? 'source'
                                                        : rw.value.from === 'map'
                                                          ? 'map'
                                                          : rw.value.from === 'boolean'
                                                            ? 'boolean'
                                                            : 'literal'
                                              }
                                              onChange={(e) => {
                                                const valType = e.target.value;
                                                let newValue: any;
                                                switch (valType) {
                                                  case 'source':
                                                    newValue = { from: 'source' };
                                                    break;
                                                  case 'map':
                                                    newValue = { from: 'map', values: {} };
                                                    break;
                                                  case 'boolean':
                                                    newValue = {
                                                      from: 'boolean',
                                                      truthy: 'enabled',
                                                      falsy: 'disabled',
                                                    };
                                                    break;
                                                  case 'null':
                                                    newValue = null;
                                                    break;
                                                  default:
                                                    newValue = '';
                                                    break;
                                                }
                                                const updated = [...rules];
                                                const newRewrites = [...updated[rIdx].rewrites];
                                                newRewrites[rwIdx] = {
                                                  ...newRewrites[rwIdx],
                                                  value: newValue,
                                                };
                                                updated[rIdx] = {
                                                  ...updated[rIdx],
                                                  rewrites: newRewrites,
                                                };
                                                const newAdapters = modelAdapters.map(
                                                  (entry: any) =>
                                                    typeof entry !== 'string' &&
                                                    entry.name === 'reasoning_rewrite'
                                                      ? {
                                                          ...entry,
                                                          options: {
                                                            ...entry.options,
                                                            rules: updated,
                                                          },
                                                        }
                                                      : entry
                                                );
                                                updateModelConfig(mId, { adapter: newAdapters });
                                              }}
                                            >
                                              <option value="literal">Literal</option>
                                              <option value="source">From source</option>
                                              <option value="map">Value map</option>
                                              <option value="boolean">Bool map</option>
                                              <option value="null">null</option>
                                            </select>
                                          </div>
                                          {/* Value input — changes meaning based on type */}
                                          <div style={{ flex: 1 }}>
                                            {(() => {
                                              if (rw.value === null)
                                                return (
                                                  <span className="font-body text-[11px] text-text-muted italic">
                                                    null
                                                  </span>
                                                );
                                              if (rw.value?.from === 'source')
                                                return (
                                                  <span className="font-body text-[11px] text-text-muted italic">
                                                    passthrough
                                                  </span>
                                                );
                                              if (rw.value?.from === 'map') {
                                                const mapStr = Object.entries(rw.value.values || {})
                                                  .map(([k, v]) => `${k}:${v}`)
                                                  .join(', ');
                                                return (
                                                  <DebouncedInput
                                                    placeholder="key:value, key:value"
                                                    value={mapStr}
                                                    onChange={(val: string) => {
                                                      const values: Record<string, any> = {};
                                                      val.split(',').forEach((pair: string) => {
                                                        const [k, ...rest] = pair.split(':');
                                                        const v = rest.join(':').trim();
                                                        if (k?.trim()) {
                                                          const numV = Number(v);
                                                          values[k.trim()] =
                                                            v === ''
                                                              ? ''
                                                              : isNaN(Number(v))
                                                                ? v
                                                                : numV;
                                                        }
                                                      });
                                                      const updated = [...rules];
                                                      const newRewrites = [
                                                        ...updated[rIdx].rewrites,
                                                      ];
                                                      newRewrites[rwIdx] = {
                                                        ...newRewrites[rwIdx],
                                                        value: { from: 'map', values },
                                                      };
                                                      updated[rIdx] = {
                                                        ...updated[rIdx],
                                                        rewrites: newRewrites,
                                                      };
                                                      const newAdapters = modelAdapters.map(
                                                        (entry: any) =>
                                                          typeof entry !== 'string' &&
                                                          entry.name === 'reasoning_rewrite'
                                                            ? {
                                                                ...entry,
                                                                options: {
                                                                  ...entry.options,
                                                                  rules: updated,
                                                                },
                                                              }
                                                            : entry
                                                      );
                                                      updateModelConfig(mId, {
                                                        adapter: newAdapters,
                                                      });
                                                    }}
                                                  />
                                                );
                                              }
                                              if (rw.value?.from === 'boolean') {
                                                return (
                                                  <div style={{ display: 'flex', gap: '4px' }}>
                                                    <DebouncedInput
                                                      placeholder="If true"
                                                      value={String(rw.value.truthy ?? '')}
                                                      onChange={(val: string) => {
                                                        const updated = [...rules];
                                                        const newRewrites = [
                                                          ...updated[rIdx].rewrites,
                                                        ];
                                                        newRewrites[rwIdx] = {
                                                          ...newRewrites[rwIdx],
                                                          value: {
                                                            ...newRewrites[rwIdx].value,
                                                            truthy: val,
                                                          },
                                                        };
                                                        updated[rIdx] = {
                                                          ...updated[rIdx],
                                                          rewrites: newRewrites,
                                                        };
                                                        const newAdapters = modelAdapters.map(
                                                          (entry: any) =>
                                                            typeof entry !== 'string' &&
                                                            entry.name === 'reasoning_rewrite'
                                                              ? {
                                                                  ...entry,
                                                                  options: {
                                                                    ...entry.options,
                                                                    rules: updated,
                                                                  },
                                                                }
                                                              : entry
                                                        );
                                                        updateModelConfig(mId, {
                                                          adapter: newAdapters,
                                                        });
                                                      }}
                                                    />
                                                    <DebouncedInput
                                                      placeholder="If false"
                                                      value={String(rw.value.falsy ?? '')}
                                                      onChange={(val: string) => {
                                                        const updated = [...rules];
                                                        const newRewrites = [
                                                          ...updated[rIdx].rewrites,
                                                        ];
                                                        newRewrites[rwIdx] = {
                                                          ...newRewrites[rwIdx],
                                                          value: {
                                                            ...newRewrites[rwIdx].value,
                                                            falsy: val,
                                                          },
                                                        };
                                                        updated[rIdx] = {
                                                          ...updated[rIdx],
                                                          rewrites: newRewrites,
                                                        };
                                                        const newAdapters = modelAdapters.map(
                                                          (entry: any) =>
                                                            typeof entry !== 'string' &&
                                                            entry.name === 'reasoning_rewrite'
                                                              ? {
                                                                  ...entry,
                                                                  options: {
                                                                    ...entry.options,
                                                                    rules: updated,
                                                                  },
                                                                }
                                                              : entry
                                                        );
                                                        updateModelConfig(mId, {
                                                          adapter: newAdapters,
                                                        });
                                                      }}
                                                    />
                                                  </div>
                                                );
                                              }
                                              // Literal value
                                              return (
                                                <DebouncedInput
                                                  placeholder="Literal value"
                                                  value={String(rw.value ?? '')}
                                                  onChange={(val: string) => {
                                                    const parsed =
                                                      val === 'true'
                                                        ? true
                                                        : val === 'false'
                                                          ? false
                                                          : isNaN(Number(val))
                                                            ? val
                                                            : Number(val);
                                                    const updated = [...rules];
                                                    const newRewrites = [...updated[rIdx].rewrites];
                                                    newRewrites[rwIdx] = {
                                                      ...newRewrites[rwIdx],
                                                      value: parsed,
                                                    };
                                                    updated[rIdx] = {
                                                      ...updated[rIdx],
                                                      rewrites: newRewrites,
                                                    };
                                                    const newAdapters = modelAdapters.map(
                                                      (entry: any) =>
                                                        typeof entry !== 'string' &&
                                                        entry.name === 'reasoning_rewrite'
                                                          ? {
                                                              ...entry,
                                                              options: {
                                                                ...entry.options,
                                                                rules: updated,
                                                              },
                                                            }
                                                          : entry
                                                    );
                                                    updateModelConfig(mId, {
                                                      adapter: newAdapters,
                                                    });
                                                  }}
                                                />
                                              );
                                            })()}
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              const updated = [...rules];
                                              const newRewrites = updated[rIdx].rewrites.filter(
                                                (_: any, i: number) => i !== rwIdx
                                              );
                                              updated[rIdx] = {
                                                ...updated[rIdx],
                                                rewrites: newRewrites,
                                              };
                                              const newAdapters = modelAdapters.map((entry: any) =>
                                                typeof entry !== 'string' &&
                                                entry.name === 'reasoning_rewrite'
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
                                            rewrites: [
                                              ...(updated[rIdx].rewrites ?? []),
                                              { target: '', value: '' },
                                            ],
                                          };
                                          const newAdapters = modelAdapters.map((entry: any) =>
                                            typeof entry !== 'string' &&
                                            entry.name === 'reasoning_rewrite'
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
                                        <span className="font-body text-[10px]">Rewrite</span>
                                      </Button>
                                      {/* Strip paths */}
                                      <div
                                        style={{
                                          borderTop: '1px solid var(--color-border-glass)',
                                          margin: '6px 0 4px 0',
                                        }}
                                      />
                                      <div className="font-body text-[10px] font-medium text-text-muted mb-1">
                                        Strip paths (remove from payload after rewrite)
                                      </div>
                                      <div
                                        style={{
                                          display: 'flex',
                                          gap: '4px',
                                          marginLeft: '8px',
                                          flexWrap: 'wrap',
                                        }}
                                      >
                                        {(rule.strip ?? []).map(
                                          (stripPath: string, sIdx: number) => (
                                            <div
                                              key={sIdx}
                                              style={{
                                                display: 'flex',
                                                gap: '2px',
                                                alignItems: 'center',
                                              }}
                                            >
                                              <div
                                                className="font-body text-[11px] text-text"
                                                style={{
                                                  padding: '2px 8px',
                                                  background: 'var(--color-bg-glass)',
                                                  border: '1px solid var(--color-border-glass)',
                                                  borderRadius: 'var(--radius-sm)',
                                                }}
                                              >
                                                {stripPath}
                                              </div>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                  const updated = [...rules];
                                                  const newStrip = updated[rIdx].strip.filter(
                                                    (_: any, i: number) => i !== sIdx
                                                  );
                                                  updated[rIdx] = {
                                                    ...updated[rIdx],
                                                    strip:
                                                      newStrip.length > 0 ? newStrip : undefined,
                                                  };
                                                  const newAdapters = modelAdapters.map(
                                                    (entry: any) =>
                                                      typeof entry !== 'string' &&
                                                      entry.name === 'reasoning_rewrite'
                                                        ? {
                                                            ...entry,
                                                            options: {
                                                              ...entry.options,
                                                              rules: updated,
                                                            },
                                                          }
                                                        : entry
                                                  );
                                                  updateModelConfig(mId, { adapter: newAdapters });
                                                }}
                                                style={{ padding: '2px' }}
                                              >
                                                <Trash2
                                                  size={10}
                                                  style={{ color: 'var(--color-danger)' }}
                                                />
                                              </Button>
                                            </div>
                                          )
                                        )}
                                      </div>
                                      <div
                                        style={{
                                          display: 'flex',
                                          gap: '4px',
                                          marginLeft: '8px',
                                          marginTop: '2px',
                                        }}
                                      >
                                        <Input
                                          placeholder="Path to strip (e.g. reasoning) — press Enter"
                                          onKeyDown={(e: any) => {
                                            if (e.key === 'Enter') {
                                              const draft = (
                                                e.target as HTMLInputElement
                                              ).value.trim();
                                              if (draft) {
                                                const updated = [...rules];
                                                updated[rIdx] = {
                                                  ...updated[rIdx],
                                                  strip: [...(updated[rIdx].strip ?? []), draft],
                                                };
                                                const newAdapters = modelAdapters.map(
                                                  (entry: any) =>
                                                    typeof entry !== 'string' &&
                                                    entry.name === 'reasoning_rewrite'
                                                      ? {
                                                          ...entry,
                                                          options: {
                                                            ...entry.options,
                                                            rules: updated,
                                                          },
                                                        }
                                                      : entry
                                                );
                                                updateModelConfig(mId, { adapter: newAdapters });
                                                (e.target as HTMLInputElement).value = '';
                                              }
                                            }
                                          }}
                                          style={{ flex: 1, fontSize: '11px' }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      const newRule = {
                                        source: '',
                                        rewrites: [{ target: '', value: '' }],
                                      };
                                      const updated = [...rules, newRule];
                                      const newAdapters = modelAdapters.map((entry: any) =>
                                        typeof entry !== 'string' &&
                                        entry.name === 'reasoning_rewrite'
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
                                  <DebouncedInput
                                    placeholder="Field Name"
                                    value={key}
                                    onChange={(newKey: string) =>
                                      updateModelKV(mId, key, newKey, val)
                                    }
                                    style={{ flex: 1 }}
                                  />
                                  <DebouncedInput
                                    placeholder="Value"
                                    value={
                                      typeof val === 'object' ? JSON.stringify(val) : String(val)
                                    }
                                    onChange={(val: string) => {
                                      try {
                                        updateModelKV(mId, key, key, JSON.parse(val));
                                      } catch {
                                        updateModelKV(mId, key, key, val);
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
                          {mCfg.auto_compat === true && (
                            <Badge
                              status="neutral"
                              style={{ fontSize: '10px', padding: '2px 8px' }}
                            >
                              Auto Compat
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
                              <label className="flex items-start gap-2 py-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={mCfg.auto_compat === true}
                                  onChange={(e) =>
                                    updateModelConfig(mId, {
                                      auto_compat: e.target.checked ? true : undefined,
                                    })
                                  }
                                />
                                <div>
                                  <div className="font-body text-[12px] text-text">Auto Compat</div>
                                  <div
                                    className="font-body text-[11px] text-text-muted"
                                    style={{ lineHeight: 1.35 }}
                                  >
                                    Use pi-ai registry hints for this model.
                                  </div>
                                </div>
                              </label>
                            </div>
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
