import { useState } from 'react';
import { Cpu, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { api, Alias } from '../../lib/api';
import { useT } from '../../i18n';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
}

export function ModelArchitectureEditor({ editingAlias, setEditingAlias }: Props) {
  const { t } = useT('models.architectureEditor');
  const [isOpen, setIsOpen] = useState(false);
  const [hfModelId, setHfModelId] = useState('');
  const [isFetchingHfModel, setIsFetchingHfModel] = useState(false);
  const [hfFetchError, setHfFetchError] = useState<string | null>(null);

  const fetchHfModelArchitecture = async () => {
    if (!hfModelId.trim()) {
      setHfFetchError(t('errorMissingHfId'));
      return;
    }
    setIsFetchingHfModel(true);
    setHfFetchError(null);
    try {
      const modelId = hfModelId.trim();
      const data = await api.fetchHuggingFaceModelArchitecture(modelId);
      const arch = data.architecture;
      setEditingAlias({
        ...editingAlias,
        model_architecture: {
          total_params: arch.total_params,
          active_params: arch.active_params,
          layers: arch.layers,
          heads: arch.heads,
          kv_lora_rank: arch.kv_lora_rank,
          qk_rope_head_dim: arch.qk_rope_head_dim,
          context_length: arch.context_length,
          dtype: arch.dtype as NonNullable<Alias['model_architecture']>['dtype'],
        },
      });
    } catch (error) {
      setHfFetchError(error instanceof Error ? error.message : t('errorFetchFailed'));
    } finally {
      setIsFetchingHfModel(false);
    }
  };

  const tp = editingAlias.model_architecture?.total_params;

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Cpu size={13} className="text-text-muted" />
          <span className="font-body text-[13px] font-medium text-text-secondary">
            {t('sectionTitle')}
          </span>
          {tp && (
            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary bg-bg-hover">
              {t('paramsBadge', { value: tp })}
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
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <p className="font-body text-[11px] text-text-muted">{t('intro')}</p>

          {/* Display currently saved architecture values */}
          {editingAlias.model_architecture?.total_params && (
            <div className="px-3 py-2 bg-bg-subtle border border-border-glass rounded-md">
              <div className="font-body text-[11px] font-medium text-text-secondary mb-1">
                {t('currentlySaved')}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text">
                {editingAlias.model_architecture.total_params && (
                  <span>{t('paramsBadge', { value: editingAlias.model_architecture.total_params })}</span>
                )}
                {editingAlias.model_architecture.active_params && (
                  <span>
                    {t('summaryActive', { value: editingAlias.model_architecture.active_params })}
                  </span>
                )}
                {editingAlias.model_architecture.layers != null && (
                  <span>{t('summaryLayers', { count: editingAlias.model_architecture.layers })}</span>
                )}
                {editingAlias.model_architecture.heads != null && (
                  <span>{t('summaryHeads', { count: editingAlias.model_architecture.heads })}</span>
                )}
                {editingAlias.model_architecture.dtype && (
                  <span className="text-primary">
                    {editingAlias.model_architecture.dtype.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* HuggingFace Model ID input and fetch button */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('hfModelIdLabel')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                value={hfModelId}
                onChange={(e) => setHfModelId(e.target.value)}
                placeholder={t('hfPlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && fetchHfModelArchitecture()}
              />
            </div>
            <Button
              onClick={fetchHfModelArchitecture}
              isLoading={isFetchingHfModel}
              disabled={isFetchingHfModel}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              {t('fetchFromHf')}
            </Button>
          </div>

          {hfFetchError && (
            <div className="text-xs text-danger bg-danger/10 border border-danger/20 rounded px-3 py-2">
              {hfFetchError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 p-3 border border-border-glass rounded-md bg-bg-subtle sm:grid-cols-2">
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldTotalParams')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="0.1"
                min="0"
                value={editingAlias.model_architecture?.total_params || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      total_params: parseFloat(e.target.value) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderSmallFloat')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldActiveParams')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="0.1"
                min="0"
                value={editingAlias.model_architecture?.active_params || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      active_params: parseFloat(e.target.value) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderSmallFloat')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldLayers')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="1"
                min="1"
                value={editingAlias.model_architecture?.layers || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      layers: parseInt(e.target.value, 10) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderInt120')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldHeads')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="1"
                min="1"
                value={editingAlias.model_architecture?.heads || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      heads: parseInt(e.target.value, 10) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderInt96')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldKvLoraRank')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="1"
                min="1"
                value={editingAlias.model_architecture?.kv_lora_rank || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      kv_lora_rank: parseInt(e.target.value, 10) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderInt128')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldRopeHeadDim')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="1"
                min="1"
                value={editingAlias.model_architecture?.qk_rope_head_dim || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      qk_rope_head_dim: parseInt(e.target.value, 10) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderInt96')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldContextLength')}
              </label>
              <input
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="1"
                min="1"
                value={editingAlias.model_architecture?.context_length || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      context_length: parseInt(e.target.value, 10) || undefined,
                    },
                  })
                }
                placeholder={t('placeholderContextExample')}
              />
            </div>
            <div>
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('fieldDataType')}
              </label>
              <select
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                value={editingAlias.model_architecture?.dtype || ''}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    model_architecture: {
                      ...editingAlias.model_architecture,
                      dtype: (e.target.value as any) || undefined,
                    },
                  })
                }
              >
                <option value="">{t('dtypeDefault')}</option>
                <option value="fp16">{t('dtypeFp16')}</option>
                <option value="bf16">{t('dtypeBf16')}</option>
                <option value="fp8">{t('dtypeFp8')}</option>
                <option value="fp8_e4m3">{t('dtypeFp8E4m3')}</option>
                <option value="fp8_e5m2">{t('dtypeFp8E5m2')}</option>
                <option value="nvfp4">{t('dtypeNvfp4')}</option>
                <option value="int4">{t('dtypeInt4')}</option>
                <option value="int8">{t('dtypeInt8')}</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
