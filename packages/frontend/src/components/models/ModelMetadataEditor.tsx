import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronDown, ChevronRight, CheckCircle, X, Loader2 } from 'lucide-react';
import { Trans } from 'react-i18next';
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
import { useT } from '../../i18n';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
  isModalOpen: boolean;
}

export function ModelMetadataEditor({ editingAlias, setEditingAlias, isModalOpen }: Props) {
  const { t } = useT('models.metadataEditor');
  const { t: tc } = useT('common');

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

  const mdSource = editingAlias.metadata?.source ?? 'openrouter';
  const codeClass = 'text-primary';

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
            <span className="font-body text-[13px] font-medium text-text-secondary">{t('sectionTitle')}</span>
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
              <Trans
                i18nKey="models.metadataEditor.intro"
                components={{
                  1: <code className={codeClass} />,
                }}
              />
            </p>

            {/* Source selector */}
            <div>
              <label
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ display: 'block', marginBottom: '4px' }}
              >
                {t('sourceLabel')}
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
                  if (prevSource !== source) {
                  }
                }}
              >
                <option value="openrouter">{t('sourceOptionOpenrouter')}</option>
                <option value="models.dev">{t('sourceOptionModelsDev')}</option>
                <option value="catwalk">{t('sourceOptionCatwalk')}</option>
                <option value="custom">{t('sourceOptionCustom')}</option>
              </select>
            </div>

            {/* Search / source_path */}
            {editingAlias.metadata?.source !== 'custom' && (
              <div style={{ position: 'relative' }}>
                <label
                  className="font-body text-[12px] font-medium text-text-secondary"
                  style={{ display: 'block', marginBottom: '4px' }}
                >
                  {t('modelLabel')}
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
                      placeholder={t('modelSearchPlaceholder', { source: mdSource })}
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
                      title={t('removeMetadataTitle')}
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
                          {t('customMetadataLabel')}
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
                          <Trans
                            i18nKey="models.metadataEditor.assignedFromCatalog"
                            values={{ source: editingAlias.metadata.source }}
                            components={{
                              1: <strong />,
                            }}
                          />
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
                          {' '}
                          {t('overrides', { count: countOverrides(editingAlias.metadata) })}
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
                {t('piModelLabel')}
              </label>
              <p className="font-body text-[11px] text-text-muted" style={{ marginBottom: '6px' }}>
                <Trans
                  i18nKey="models.metadataEditor.piModelIntro"
                  components={{
                    1: <code className={codeClass} />,
                    2: <code className={codeClass} />,
                  }}
                />
              </p>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
                  <option value="">{t('piNone')}</option>
                  {piProviders.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

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
                      <option value="">{t('piSelectModel')}</option>
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
                    title={t('removePiModelTitle')}
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>

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
                      {t('piModelBadge')}{' '}
                      <strong>{editingAlias.pi_model.provider}</strong>
                      {' / '}
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
                {t('preferredApiLabel')}
              </label>
              <p className="font-body text-[11px] text-text-muted" style={{ marginBottom: '6px' }}>
                <Trans i18nKey="models.metadataEditor.preferredApiIntro" components={{ 1: <code className={codeClass} /> }} />
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
                <option value="">{tc('none')}</option>
                <option value="chat_completions">{t('preferredApiChatCompletions')}</option>
                <option value="messages">{t('preferredApiMessages')}</option>
                <option value="gemini">{t('preferredApiGemini')}</option>
                <option value="responses">{t('preferredApiResponses')}</option>
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
                    <label className="font-body text-[12px] font-medium text-text-secondary" style={{ marginBottom: 0 }}>
                      {t('overrideCatalogToggle')}
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
