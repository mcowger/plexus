import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronDown, ChevronRight, CheckCircle, X, Loader2 } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { MetadataOverrideForm } from './MetadataOverrideForm';
import { useMetadataEditor } from '../../hooks/useMetadataEditor';
import { api } from '../../lib/api';
import type {
  Alias,
  AliasMetadata,
  MetadataSource,
  MetadataOverrides,
  PreferredApiValue,
} from '../../lib/api';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
  isModalOpen: boolean;
}

export function ModelMetadataEditor({ editingAlias, setEditingAlias, isModalOpen }: Props) {
  const [isOpen, setIsOpen] = useState(false);
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
  const [piModels, setPiModels] = useState<Array<{ id: string; name: string; api: string }>>([]);
  const [piModelsLoading, setPiModelsLoading] = useState(false);

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
            {editingAlias.metadata && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary bg-bg-hover">
                {editingAlias.metadata.source}
              </span>
            )}
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
            <p className="font-body text-[11px] text-text-muted">
              Link this alias to a model in an external catalog. When configured, Plexus includes
              enriched metadata (name, context length, pricing, supported parameters) in the{' '}
              <code className="text-primary">GET /v1/models</code> response.
            </p>

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
                value={editingAlias.metadata?.source ?? 'openrouter'}
                onChange={(e) => {
                  const source = e.target.value as MetadataSource;
                  const prevSource = editingAlias.metadata?.source;
                  const existingOverrides = editingAlias.metadata?.overrides;
                  const existingSourcePath = editingAlias.metadata?.source_path;
                  const carryPath = prevSource === source || source === 'custom';
                  const carriedSourcePath = carryPath ? existingSourcePath : undefined;
                  let next: AliasMetadata;
                  if (source === 'custom') {
                    const defaults = buildCustomDefaults(editingAlias.id);
                    const existing = existingOverrides ?? {};
                    const mergedOverrides = {
                      ...defaults,
                      ...existing,
                      ...(defaults.pricing || existing.pricing
                        ? { pricing: { ...(defaults.pricing ?? {}), ...(existing.pricing ?? {}) } }
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
                <option value="openrouter">OpenRouter</option>
                <option value="models.dev">models.dev</option>
                <option value="catwalk">Catwalk (Charm)</option>
                <option value="custom">Custom (manual entry)</option>
              </select>
            </div>

            {/* Search / source_path */}
            {editingAlias.metadata?.source !== 'custom' && (
              <div style={{ position: 'relative' }}>
                <label
                  className="font-body text-[12px] font-medium text-text-secondary"
                  style={{ display: 'block', marginBottom: '4px' }}
                >
                  Model
                  {editingAlias.metadata?.source_path && (
                    <span className="ml-2 font-normal text-text-muted">
                      ({editingAlias.metadata.source_path})
                    </span>
                  )}
                </label>
                <div style={{ position: 'relative', display: 'flex', gap: '4px' }}>
                  <div ref={metadataInputWrapperRef} style={{ position: 'relative', flex: 1 }}>
                    <Input
                      value={metadataQuery}
                      onChange={(e) => {
                        const src = editingAlias.metadata?.source ?? 'openrouter';
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
                            setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                          }
                          setShowMetadataDropdown(true);
                        }
                      }}
                      placeholder={`Search ${editingAlias.metadata?.source ?? 'openrouter'} catalog...`}
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
                      style={{ color: 'var(--color-danger)', padding: '4px', minHeight: 'auto' }}
                      title="Remove metadata"
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Selected metadata preview */}
            {editingAlias.metadata &&
              (editingAlias.metadata.source === 'custom' ||
                editingAlias.metadata.source_path ||
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
              <p className="font-body text-[11px] text-text-muted" style={{ marginBottom: '6px' }}>
                Link to a pi-ai model to include its compatibility options as{' '}
                <code className="text-primary">pi_options</code> in{' '}
                <code className="text-primary">GET /v1/models</code>.
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
                      setEditingAlias({ ...editingAlias, pi_model: { provider, model_id: '' } });
                    }
                  }}
                >
                  <option value="">None</option>
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
                      {piModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.id})
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
                    title="Remove pi model"
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
            <div>
              <label
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ display: 'block', marginBottom: '4px' }}
              >
                Preferred API
              </label>
              <p className="font-body text-[11px] text-text-muted" style={{ marginBottom: '6px' }}>
                Advertised in <code className="text-primary">/v1/models</code> to inform clients of
                the recommended API surface for this alias.
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
                <option value="">None</option>
                <option value="chat_completions">Chat Completions (/v1/chat/completions)</option>
                <option value="messages">Messages (/v1/messages)</option>
                <option value="gemini">Gemini (Google Gemini API)</option>
                <option value="responses">Responses (/v1/responses)</option>
              </select>
            </div>

            {/* Override toggle + editable form */}
            {editingAlias.metadata && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {editingAlias.metadata.source !== 'custom' && (
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
                      Override catalog fields
                    </label>
                    <Switch
                      checked={isOverrideOpen}
                      onChange={(v) => {
                        setIsOverrideOpen(v);
                        if (!v) {
                          const current = editingAlias.metadata;
                          if (current) {
                            const { overrides: _o, ...rest } = current;
                            setEditingAlias({ ...editingAlias, metadata: rest as AliasMetadata });
                          }
                        } else {
                          const cur = editingAlias.metadata;
                          if (cur && cur.source !== 'custom' && cur.source_path) {
                            populateOverridesFromCatalog(cur.source, cur.source_path);
                          }
                        }
                      }}
                    />
                  </div>
                )}

                {(isOverrideOpen || editingAlias.metadata.source === 'custom') && (
                  <MetadataOverrideForm
                    overrides={editingAlias.metadata.overrides ?? {}}
                    isCustom={editingAlias.metadata.source === 'custom'}
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
            {metadataResults.map((result) => (
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
