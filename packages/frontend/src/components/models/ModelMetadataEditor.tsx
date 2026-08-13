import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  X,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { MetadataOverrideForm } from './MetadataOverrideForm';
import { useMetadataEditor } from '../../hooks/useMetadataEditor';
import { api } from '../../lib/api';
import { dedupeById } from '../../lib/modelOptions';
import { useToast } from '../../contexts/ToastContext';
import type {
  Alias,
  AliasMetadata,
  MetadataSource,
  MetadataOverrides,
  ModelResolutionPreview,
  PreferredApiValue,
} from '../../lib/api';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
  isModalOpen: boolean;
}

export function ModelMetadataEditor({ editingAlias, setEditingAlias, isModalOpen }: Props) {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvancedMetadata, setShowAdvancedMetadata] = useState(false);
  const {
    isOverrideOpen,
    setIsOverrideOpen,
    metadataQuery,
    metadataResults,
    isMetadataSearching,
    showMetadataDropdown,
    setShowMetadataDropdown,
    dropdownRect,
    setDropdownRect,
    metadataInputWrapperRef,
    handleMetadataSearch,
    selectMetadataResult,
    clearMetadata,
    setOverrideField,
    setPricingField,
    setArchitectureField,
    setTopProviderField,
    countOverrides,
    populateOverridesFromCatalog,
    buildCustomDefaults,
  } = useMetadataEditor(editingAlias, setEditingAlias, isModalOpen);

  // ── Pi model selector state ──────────────────────────────────────────
  const [piProviders, setPiProviders] = useState<string[]>([]);
  const [piModels, setPiModels] = useState<
    Array<{ id: string; name: string; api: string; custom: boolean }>
  >([]);
  const [piModelsLoading, setPiModelsLoading] = useState(false);
  const [automaticResolution, setAutomaticResolution] = useState<ModelResolutionPreview | null>(
    null
  );
  const [isResolvingAutomatically, setIsResolvingAutomatically] = useState(false);
  const [automaticResolutionFailed, setAutomaticResolutionFailed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    api
      .getPiProviders()
      .then(setPiProviders)
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    const provider = editingAlias.pi_model?.provider;
    if (!provider) {
      setPiModels([]);
      return;
    }
    setPiModelsLoading(true);
    api
      .getPiModels(provider)
      .then(setPiModels)
      .catch(() => setPiModels([]))
      .finally(() => setPiModelsLoading(false));
  }, [editingAlias.pi_model?.provider]);

  const metadataSource = editingAlias.metadata?.source ?? 'auto';
  const isCatalogSource =
    metadataSource === 'openrouter' ||
    metadataSource === 'models.dev' ||
    metadataSource === 'catwalk';
  const catalogMetadata =
    editingAlias.metadata?.source === 'openrouter' ||
    editingAlias.metadata?.source === 'models.dev' ||
    editingAlias.metadata?.source === 'catwalk'
      ? editingAlias.metadata
      : undefined;
  const metadataOverrides =
    editingAlias.metadata && editingAlias.metadata.source !== 'disabled'
      ? editingAlias.metadata.overrides
      : undefined;
  const hasManualMetadataSelections =
    metadataSource !== 'auto' ||
    !!editingAlias.pi_model ||
    !!editingAlias.preferred_api?.length ||
    !!(metadataOverrides && Object.keys(metadataOverrides).length > 0);
  const metadataStatus =
    metadataSource === 'auto'
      ? {
          label: 'Automatic metadata enabled',
          description: 'Selections update automatically when enabled targets change.',
        }
      : metadataSource === 'disabled'
        ? {
            label: 'Metadata disabled',
            description: 'This alias only exposes the basic OpenAI model-list fields.',
          }
        : metadataSource === 'custom'
          ? {
              label: 'Custom metadata',
              description: 'This alias uses manually configured metadata fields.',
            }
          : {
              label: `Pinned to ${metadataSource}`,
              description: catalogMetadata?.source_path
                ? `Using ${catalogMetadata.source_path}.`
                : 'Choose the catalog model in Advanced settings.',
            };

  useEffect(() => {
    if (isModalOpen) setShowAdvancedMetadata(false);
  }, [isModalOpen, editingAlias.id]);

  useEffect(() => {
    const hasInput =
      editingAlias.id.trim().length > 0 ||
      !!editingAlias.pi_model?.model_id ||
      editingAlias.target_groups.some((group) =>
        group.targets.some((target) => target.enabled !== false && !!target.model?.trim().length)
      );
    if (!isOpen || metadataSource !== 'auto' || !hasInput) {
      setAutomaticResolution(null);
      setIsResolvingAutomatically(false);
      setAutomaticResolutionFailed(false);
      return;
    }

    let cancelled = false;
    setIsResolvingAutomatically(true);
    setAutomaticResolutionFailed(false);
    const timer = setTimeout(() => {
      api
        .previewModelResolution(editingAlias)
        .then((resolution) => {
          if (!cancelled) setAutomaticResolution(resolution);
        })
        .catch(() => {
          if (!cancelled) {
            setAutomaticResolution(null);
            setAutomaticResolutionFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) setIsResolvingAutomatically(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, metadataSource, editingAlias]);

  const resetToAutomatic = async () => {
    const confirmed = await toast.confirm({
      title: 'Reset to Automatic?',
      message:
        'This removes the pinned metadata source, Pi model, preferred API, and all metadata overrides. Plexus will derive them again from enabled targets.',
      confirmLabel: 'Reset to Automatic',
      variant: 'danger',
    });
    if (!confirmed) return;

    clearMetadata();
    setEditingAlias((current) => {
      const {
        metadata: _metadata,
        pi_model: _piModel,
        preferred_api: _preferredApi,
        ...automatic
      } = current;
      return automatic as Alias;
    });
    setShowAdvancedMetadata(false);
  };

  return (
    <>
      <div className="border border-border-glass rounded-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BookOpen size={13} className="text-text-muted" />
            <span className="font-body text-[13px] font-medium text-text-secondary">Metadata</span>
            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary bg-bg-hover">
              {metadataSource === 'auto' ? 'automatic' : metadataSource}
            </span>
          </div>
          {isOpen ? (
            <ChevronDown size={14} className="text-text-muted" />
          ) : (
            <ChevronRight size={14} className="text-text-muted" />
          )}
        </button>

        {isOpen && (
          <div
            className="px-3 py-3 border-t border-border-glass"
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div
              className="rounded-sm border border-border-glass bg-bg-subtle px-3 py-3"
              style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}
            >
              <div>
                <div
                  className="font-body text-[12px] font-medium text-text-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CheckCircle size={13} className="text-success" />
                  {metadataStatus.label}
                </div>
                <p className="font-body text-[11px] text-text-muted mt-1">
                  {metadataStatus.description}
                </p>
                {metadataSource === 'auto' && (
                  <div
                    className="font-body text-[11px] text-text-muted mt-2"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      columnGap: '12px',
                      rowGap: '4px',
                    }}
                  >
                    {isResolvingAutomatically ? (
                      <span>Resolving automatic selections…</span>
                    ) : automaticResolutionFailed ? (
                      <span className="text-danger">Could not preview automatic selections.</span>
                    ) : automaticResolution ? (
                      <>
                        <span>
                          Model:{' '}
                          <code className="text-primary">
                            {automaticResolution.canonical_model.provider
                              ? `${automaticResolution.canonical_model.provider} / `
                              : ''}
                            {automaticResolution.canonical_model.model}
                          </code>
                        </span>
                        <span>
                          Pi model:{' '}
                          {automaticResolution.pi_model ? (
                            <code className="text-primary">
                              {automaticResolution.pi_model.provider} /{' '}
                              {automaticResolution.pi_model.model_id}
                            </code>
                          ) : (
                            'No registry match'
                          )}
                        </span>
                        <span>
                          Metadata:{' '}
                          {automaticResolution.metadata?.source === 'heuristic'
                            ? 'Safe name and modality defaults'
                            : automaticResolution.metadata
                              ? `${automaticResolution.metadata.source} · ${automaticResolution.metadata.source_path}`
                              : 'Disabled'}
                        </span>
                        <span>
                          Preferred API:{' '}
                          {automaticResolution.preferred_api ? (
                            <code className="text-primary">
                              {automaticResolution.preferred_api[0]}
                            </code>
                          ) : (
                            'Not applicable'
                          )}
                        </span>
                      </>
                    ) : (
                      <span>Add an alias name or enabled target to preview selections.</span>
                    )}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  flex: '0 0 auto',
                  alignSelf: 'center',
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedMetadata((current) => !current)}
                >
                  {showAdvancedMetadata ? 'Hide settings' : 'Advanced settings'}
                </Button>
                {hasManualMetadataSelections && (
                  <Button variant="danger" size="sm" onClick={resetToAutomatic}>
                    <RotateCcw size={12} />
                    Reset to Automatic
                  </Button>
                )}
              </div>
            </div>

            {showAdvancedMetadata && (
              <div
                className="border-t border-border-glass pt-3"
                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                {/* Source selector */}
                <div>
                  <label
                    className="font-body text-[12px] font-medium text-text-secondary"
                    style={{ display: 'block', marginBottom: '4px' }}
                  >
                    Source
                  </label>
                  <select
                    className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                    style={{ padding: '5px 8px', height: '30px' }}
                    value={metadataSource}
                    onChange={(e) => {
                      const source = e.target.value as MetadataSource;
                      const prevSource = editingAlias.metadata?.source;
                      const existingOverrides = metadataOverrides;
                      const existingSourcePath =
                        editingAlias.metadata && 'source_path' in editingAlias.metadata
                          ? editingAlias.metadata.source_path
                          : undefined;
                      const carryPath = prevSource === source || source === 'custom';
                      const carriedSourcePath = carryPath ? existingSourcePath : undefined;
                      let next: AliasMetadata;
                      if (source === 'auto') {
                        next = {
                          source: 'auto',
                          ...(existingOverrides ? { overrides: existingOverrides } : {}),
                        };
                      } else if (source === 'disabled') {
                        next = { source: 'disabled' };
                        setIsOverrideOpen(false);
                      } else if (source === 'custom') {
                        const defaults = buildCustomDefaults(editingAlias.id);
                        const existing = existingOverrides ?? {};
                        const mergedOverrides = {
                          ...defaults,
                          ...existing,
                          ...(defaults.pricing || existing.pricing
                            ? {
                                pricing: {
                                  ...(defaults.pricing ?? {}),
                                  ...(existing.pricing ?? {}),
                                },
                              }
                            : {}),
                          ...(defaults.architecture || existing.architecture
                            ? {
                                architecture: {
                                  ...(defaults.architecture ?? {}),
                                  ...(existing.architecture ?? {}),
                                },
                              }
                            : {}),
                          ...(defaults.top_provider || existing.top_provider
                            ? {
                                top_provider: {
                                  ...(defaults.top_provider ?? {}),
                                  ...(existing.top_provider ?? {}),
                                },
                              }
                            : {}),
                        } as MetadataOverrides & { name: string };
                        next = {
                          source: 'custom',
                          ...(carriedSourcePath ? { source_path: carriedSourcePath } : {}),
                          overrides: mergedOverrides,
                        };
                        setIsOverrideOpen(true);
                      } else {
                        next = {
                          source,
                          source_path: carriedSourcePath ?? '',
                          ...(existingOverrides ? { overrides: existingOverrides } : {}),
                        };
                      }
                      setEditingAlias({ ...editingAlias, metadata: next });
                      // Kill any pending search from the prior source.
                      if (prevSource !== source) {
                        // The source change handler in useMetadataEditor handles
                        // debounce cancellation via state resets.
                      }
                    }}
                  >
                    <option value="auto">Automatic (recommended)</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="models.dev">models.dev</option>
                    <option value="catwalk">Catwalk (Charm)</option>
                    <option value="custom">Custom (manual entry)</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                {/* Search / source_path */}
                {isCatalogSource && (
                  <div style={{ position: 'relative' }}>
                    <label
                      className="font-body text-[12px] font-medium text-text-secondary"
                      style={{ display: 'block', marginBottom: '4px' }}
                    >
                      Model
                      {catalogMetadata?.source_path && (
                        <span className="ml-2 font-normal text-text-muted">
                          ({catalogMetadata.source_path})
                        </span>
                      )}
                    </label>
                    <div style={{ position: 'relative', display: 'flex', gap: '4px' }}>
                      <div ref={metadataInputWrapperRef} style={{ position: 'relative', flex: 1 }}>
                        <Input
                          value={metadataQuery}
                          onChange={(e) => {
                            const src = catalogMetadata?.source ?? 'openrouter';
                            handleMetadataSearch(e.target.value, src);
                            if (metadataInputWrapperRef.current) {
                              const r = metadataInputWrapperRef.current.getBoundingClientRect();
                              setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                            }
                          }}
                          onFocus={() => {
                            if (metadataResults.length > 0) {
                              if (metadataInputWrapperRef.current) {
                                const r = metadataInputWrapperRef.current.getBoundingClientRect();
                                setDropdownRect({
                                  top: r.bottom + 2,
                                  left: r.left,
                                  width: r.width,
                                });
                              }
                              setShowMetadataDropdown(true);
                            }
                          }}
                          placeholder={`Search ${catalogMetadata?.source ?? 'openrouter'} catalog...`}
                          style={{
                            width: '100%',
                            paddingRight: isMetadataSearching ? '28px' : undefined,
                          }}
                          onBlur={() => setShowMetadataDropdown(false)}
                        />
                        {isMetadataSearching && (
                          <Loader2
                            size={14}
                            className="animate-spin text-text-muted"
                            style={{
                              position: 'absolute',
                              right: '8px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                            }}
                          />
                        )}
                      </div>
                      {editingAlias.metadata && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearMetadata}
                          style={{
                            color: 'var(--color-danger)',
                            padding: '4px',
                            minHeight: 'auto',
                          }}
                          title="Return to automatic metadata"
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Selected metadata preview */}
                {editingAlias.metadata &&
                  editingAlias.metadata.source !== 'auto' &&
                  editingAlias.metadata.source !== 'disabled' &&
                  (editingAlias.metadata.source === 'custom' ||
                    ('source_path' in editingAlias.metadata && editingAlias.metadata.source_path) ||
                    editingAlias.metadata.overrides) && (
                    <div
                      className="rounded-sm border border-border-glass bg-bg-subtle px-3 py-2"
                      style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle size={12} className="text-success" />
                        <span>
                          {editingAlias.metadata.source === 'custom' ? (
                            <>
                              Custom metadata
                              {editingAlias.metadata.source_path && (
                                <>
                                  :{' '}
                                  <code className="text-primary">
                                    {editingAlias.metadata.source_path}
                                  </code>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              Metadata assigned from <strong>{editingAlias.metadata.source}</strong>
                              {editingAlias.metadata.source_path && (
                                <>
                                  :{' '}
                                  <code className="text-primary">
                                    {editingAlias.metadata.source_path}
                                  </code>
                                </>
                              )}
                            </>
                          )}
                          {countOverrides(editingAlias.metadata) > 0 && (
                            <span className="ml-2 text-text-muted">
                              + {countOverrides(editingAlias.metadata)} field
                              {countOverrides(editingAlias.metadata) === 1 ? '' : 's'} overridden
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                {/* Pi model */}
                <div>
                  <label
                    className="font-body text-[12px] font-medium text-text-secondary"
                    style={{ display: 'block', marginBottom: '4px' }}
                  >
                    Pi model
                  </label>
                  <p
                    className="font-body text-[11px] text-text-muted"
                    style={{ marginBottom: '6px' }}
                  >
                    Automatic derives the model from enabled targets. Choose a pi-ai model only to
                    override that match and advertise its{' '}
                    <code className="text-primary">pi_options</code>.
                  </p>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {/* Provider dropdown */}
                    <select
                      className="font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                      style={{
                        padding: '5px 8px',
                        height: '30px',
                        flex: '0 0 auto',
                        maxWidth: '160px',
                      }}
                      value={editingAlias.pi_model?.provider ?? ''}
                      onChange={(e) => {
                        const provider = e.target.value;
                        if (!provider) {
                          const { pi_model: _removed, ...rest } = editingAlias;
                          setEditingAlias(rest as Alias);
                        } else {
                          setEditingAlias({
                            ...editingAlias,
                            pi_model: { provider, model_id: '' },
                          });
                        }
                      }}
                    >
                      <option value="">Automatic (from targets)</option>
                      {piProviders.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>

                    {/* Model dropdown */}
                    {editingAlias.pi_model?.provider && (
                      <div style={{ position: 'relative', flex: 1 }}>
                        <select
                          className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                          style={{
                            padding: '5px 8px',
                            height: '30px',
                            paddingRight: piModelsLoading ? '28px' : undefined,
                          }}
                          value={editingAlias.pi_model?.model_id ?? ''}
                          onChange={(e) => {
                            const model_id = e.target.value;
                            setEditingAlias({
                              ...editingAlias,
                              pi_model: { provider: editingAlias.pi_model!.provider, model_id },
                            });
                          }}
                        >
                          <option value="">Select model...</option>
                          {dedupeById(piModels).map((m) => (
                            <option key={m.id} value={m.id} title={m.api}>
                              {m.name} ({m.id}){m.custom ? ' — custom' : ''}
                            </option>
                          ))}
                        </select>
                        {piModelsLoading && (
                          <Loader2
                            size={14}
                            className="animate-spin text-text-muted"
                            style={{
                              position: 'absolute',
                              right: '8px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </div>
                    )}

                    {/* Clear pi model */}
                    {editingAlias.pi_model?.model_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const { pi_model: _removed, ...rest } = editingAlias;
                          setEditingAlias(rest as Alias);
                        }}
                        style={{
                          color: 'var(--color-danger)',
                          padding: '4px',
                          minHeight: 'auto',
                          flex: '0 0 auto',
                        }}
                        title="Return to automatic Pi model matching"
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>

                  {/* Confirmation badge */}
                  {editingAlias.pi_model?.model_id && (
                    <div
                      className="rounded-sm border border-border-glass bg-bg-subtle px-3 py-2"
                      style={{
                        fontSize: '11px',
                        color: 'var(--color-text-secondary)',
                        marginTop: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle size={12} className="text-success" />
                        <span>
                          Pi model: <strong>{editingAlias.pi_model.provider}</strong>
                          {' / '}
                          <code className="text-primary">{editingAlias.pi_model.model_id}</code>
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Preferred API */}
                {((editingAlias.type ?? 'text') === 'text' ||
                  !!editingAlias.preferred_api?.length) && (
                  <div>
                    <label
                      className="font-body text-[12px] font-medium text-text-secondary"
                      style={{ display: 'block', marginBottom: '4px' }}
                    >
                      Preferred API
                    </label>
                    <p
                      className="font-body text-[11px] text-text-muted"
                      style={{ marginBottom: '6px' }}
                    >
                      Advertised in <code className="text-primary">/v1/models</code>. Automatic uses
                      Messages for Claude, Responses for GPT, Gemini for Gemini models, and Chat
                      Completions for everything else.
                    </p>
                    <select
                      className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                      style={{ padding: '5px 8px', height: '30px' }}
                      value={(editingAlias.preferred_api ?? [])[0] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value as PreferredApiValue | '';
                        setEditingAlias({
                          ...editingAlias,
                          preferred_api: val ? [val] : undefined,
                        });
                      }}
                    >
                      <option value="">Automatic (inferred)</option>
                      <option value="chat_completions">
                        Chat Completions (/v1/chat/completions)
                      </option>
                      <option value="messages">Messages (/v1/messages)</option>
                      <option value="gemini">Gemini (Google Gemini API)</option>
                      <option value="responses">Responses (/v1/responses)</option>
                    </select>
                  </div>
                )}

                {/* Override toggle + editable form */}
                {metadataSource !== 'disabled' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {metadataSource !== 'custom' && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <label
                          className="font-body text-[12px] font-medium text-text-secondary"
                          style={{ marginBottom: 0 }}
                        >
                          Override metadata fields
                        </label>
                        <Switch
                          checked={isOverrideOpen}
                          onChange={(v) => {
                            setIsOverrideOpen(v);
                            if (!v) {
                              const current = editingAlias.metadata;
                              if (current && current.source !== 'disabled') {
                                const { overrides: _o, ...rest } = current;
                                setEditingAlias({
                                  ...editingAlias,
                                  metadata: rest as AliasMetadata,
                                });
                              }
                            } else {
                              const cur = editingAlias.metadata;
                              if (!cur) {
                                setEditingAlias({
                                  ...editingAlias,
                                  metadata: { source: 'auto', overrides: {} },
                                });
                              } else if (
                                cur.source !== 'auto' &&
                                cur.source !== 'disabled' &&
                                cur.source !== 'custom' &&
                                cur.source_path
                              ) {
                                populateOverridesFromCatalog(cur.source, cur.source_path);
                              }
                            }
                          }}
                        />
                      </div>
                    )}

                    {(isOverrideOpen || metadataSource === 'custom') && (
                      <MetadataOverrideForm
                        overrides={metadataOverrides ?? {}}
                        isCustom={metadataSource === 'custom'}
                        onSetField={setOverrideField}
                        onSetPricing={setPricingField}
                        onSetArchitecture={setArchitectureField}
                        onSetTopProvider={setTopProviderField}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metadata autocomplete portal */}
      {showMetadataDropdown &&
        metadataResults.length > 0 &&
        dropdownRect &&
        createPortal(
          <div
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 9999,
              backgroundColor: '#1E293B',
              border: '1px solid var(--color-border-glass)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxHeight: '180px',
              overflowY: 'auto',
            }}
          >
            {dedupeById(metadataResults).map((result) => (
              <button
                key={result.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMetadataResult(result);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border-glass)',
                }}
                className="hover:bg-bg-hover transition-colors"
              >
                <div className="font-body text-[12px] font-medium text-text">{result.name}</div>
                <div className="font-body text-[10px] text-text-muted">{result.id}</div>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
