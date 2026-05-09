import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { Download } from 'lucide-react';
import type { FetchedModel } from '../../hooks/useProviderForm';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  modelsUrl: string;
  setModelsUrl: (url: string) => void;
  isFetchingModels: boolean;
  fetchedModels: FetchedModel[];
  selectedModelIds: Set<string>;
  fetchError: string | null;
  isOAuthMode: boolean;
  onFetch: () => Promise<void>;
  onToggleSelection: (modelId: string) => void;
  onAddSelected: () => void;
}

export function FetchModelsModal({
  isOpen,
  onClose,
  modelsUrl,
  setModelsUrl,
  isFetchingModels,
  fetchedModels,
  selectedModelIds,
  fetchError,
  isOAuthMode,
  onFetch,
  onToggleSelection,
  onAddSelected,
}: Props) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Fetch Models from Provider"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onAddSelected} disabled={selectedModelIds.size === 0}>
            Add {selectedModelIds.size} Model{selectedModelIds.size !== 1 ? 's' : ''}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              label="Models Endpoint URL"
              value={modelsUrl}
              onChange={(e) => setModelsUrl(e.target.value)}
              placeholder={
                isOAuthMode
                  ? 'OAuth providers use built-in model lists'
                  : 'https://api.example.com/v1/models'
              }
              disabled={isOAuthMode}
            />
          </div>
          <Button
            onClick={onFetch}
            isLoading={isFetchingModels}
            leftIcon={<Download size={16} />}
            className="w-full sm:w-auto"
          >
            Fetch
          </Button>
        </div>
        {fetchError && (
          <div
            style={{
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)',
              fontSize: '13px',
            }}
          >
            {fetchError}
          </div>
        )}
        {fetchedModels.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="font-body text-[13px] font-medium text-text-secondary">
                Available Models ({fetchedModels.length})
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fetchedModels.forEach((m) => onToggleSelection(m.id))}
                >
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => selectedModelIds.forEach((id) => onToggleSelection(id))}
                >
                  Clear
                </Button>
              </div>
            </div>
            <div
              style={{
                maxHeight: '400px',
                overflowY: 'auto',
                border: '1px solid var(--color-border-glass)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-deep)',
              }}
            >
              {fetchedModels.map((model) => {
                const contextLengthK = model.context_length
                  ? `${(model.context_length / 1000).toFixed(0)}K`
                  : null;
                return (
                  <div
                    key={model.id}
                    style={{
                      padding: '12px',
                      borderBottom: '1px solid var(--color-border-glass)',
                      cursor: 'pointer',
                      background: selectedModelIds.has(model.id)
                        ? 'var(--color-bg-hover)'
                        : 'transparent',
                      transition: 'background 0.2s',
                    }}
                    onClick={() => onToggleSelection(model.id)}
                    className="hover:bg-bg-hover"
                  >
                    <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
                      <input
                        type="checkbox"
                        checked={selectedModelIds.has(model.id)}
                        onChange={() => onToggleSelection(model.id)}
                        style={{ marginTop: '2px', cursor: 'pointer' }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '4px',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: '13px',
                              color: 'var(--color-text)',
                            }}
                          >
                            {model.id}
                          </span>
                          {contextLengthK && (
                            <Badge
                              status="connected"
                              style={{ fontSize: '10px', padding: '2px 6px' }}
                            >
                              {contextLengthK}
                            </Badge>
                          )}
                        </div>
                        {model.name && model.name !== model.id && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--color-text-secondary)',
                              marginBottom: '2px',
                            }}
                          >
                            {model.name}
                          </div>
                        )}
                        {model.description && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--color-text-muted)',
                              marginTop: '4px',
                              lineHeight: '1.4',
                            }}
                          >
                            {model.description.length > 150
                              ? `${model.description.substring(0, 150)}...`
                              : model.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!isFetchingModels && fetchedModels.length === 0 && !fetchError && (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: '13px',
              fontStyle: 'italic',
            }}
          >
            {isOAuthMode
              ? 'Click Fetch to load known OAuth models'
              : 'Enter a URL and click Fetch to load available models'}
          </div>
        )}
      </div>
    </Modal>
  );
}
