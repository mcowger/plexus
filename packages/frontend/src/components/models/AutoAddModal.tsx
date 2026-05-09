import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { Provider, Model, AliasTargetGroup } from '../../lib/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  providers: Provider[];
  availableModels: Model[];
  targetGroups: AliasTargetGroup[];
  onAddTargets: (targets: Array<{ provider: string; model: string }>) => void;
  preFillQuery?: string;
}

export function AutoAddModal({
  isOpen,
  onClose,
  providers,
  availableModels,
  targetGroups,
  onAddTargets,
  preFillQuery = '',
}: Props) {
  const [substring, setSubstring] = useState(preFillQuery);
  const [filteredModels, setFilteredModels] = useState<Array<{ model: Model; provider: Provider }>>(
    []
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  const handleSearchModels = (query?: string) => {
    const searchTerm = query !== undefined ? query : substring;
    if (!searchTerm.trim()) {
      setFilteredModels([]);
      return;
    }
    const searchLower = searchTerm.toLowerCase();
    const matches: Array<{ model: Model; provider: Provider }> = [];
    availableModels.forEach((model) => {
      const provider = providers.find((p) => p.id === model.providerId);
      if (
        provider &&
        (model.name.toLowerCase().includes(searchLower) ||
          provider.name.toLowerCase().includes(searchLower))
      ) {
        matches.push({ model, provider: { ...provider } });
      }
    });
    setFilteredModels(matches);
  };

  const handleToggleModelSelection = (modelId: string, providerId: string) => {
    const key = `${providerId}|${modelId}`;
    const newSelection = new Set(selectedModels);
    if (newSelection.has(key)) {
      newSelection.delete(key);
    } else {
      newSelection.add(key);
    }
    setSelectedModels(newSelection);
  };

  const handleAddSelectedModels = () => {
    const targets: Array<{ provider: string; model: string }> = [];
    selectedModels.forEach((key) => {
      const separatorIndex = key.indexOf('|');
      const providerId = key.substring(0, separatorIndex);
      const modelId = key.substring(separatorIndex + 1);
      targets.push({ provider: providerId, model: modelId });
    });
    onAddTargets(targets);
    setSubstring('');
    setFilteredModels([]);
    setSelectedModels(new Set());
  };

  const group0Targets = targetGroups[0]?.targets ?? [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Auto Add Targets"
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAddSelectedModels} disabled={selectedModels.size === 0}>
            Add {selectedModels.size} Target{selectedModels.size !== 1 ? 's' : ''}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <Input
              placeholder="Search models (e.g. 'gpt-4', 'claude')"
              value={substring}
              onChange={(e) => setSubstring(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchModels()}
            />
          </div>
          <Button onClick={() => handleSearchModels()} className="w-full sm:w-auto">
            Search
          </Button>
        </div>

        {filteredModels.length > 0 ? (
          <div
            style={{
              maxHeight: '400px',
              overflowY: 'auto',
              overflowX: 'auto',
              border: '1px solid var(--color-border-glass)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <table className="w-full border-collapse font-body text-[13px]">
              <thead
                style={{
                  position: 'sticky',
                  top: 0,
                  backgroundColor: 'var(--color-bg-hover)',
                  zIndex: 10,
                }}
              >
                <tr>
                  <th
                    className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                    style={{ width: '40px' }}
                  >
                    <input
                      type="checkbox"
                      checked={
                        filteredModels.length > 0 &&
                        filteredModels.every(
                          (m) =>
                            selectedModels.has(`${m.provider.id}|${m.model.id}`) ||
                            group0Targets.some(
                              (t: any) => t.provider === m.provider.id && t.model === m.model.id
                            )
                        )
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          const newSelection = new Set(selectedModels);
                          filteredModels.forEach((m) => {
                            const key = `${m.provider.id}|${m.model.id}`;
                            if (
                              !group0Targets.some(
                                (t: any) => t.provider === m.provider.id && t.model === m.model.id
                              )
                            ) {
                              newSelection.add(key);
                            }
                          });
                          setSelectedModels(newSelection);
                        } else {
                          const newSelection = new Set(selectedModels);
                          filteredModels.forEach((m) => {
                            newSelection.delete(`${m.provider.id}|${m.model.id}`);
                          });
                          setSelectedModels(newSelection);
                        }
                      }}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Model
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map(({ model, provider }) => {
                  const key = `${provider.id}|${model.id}`;
                  const alreadyExists = group0Targets.some(
                    (t: any) => t.provider === provider.id && t.model === model.id
                  );
                  const isSelected = selectedModels.has(key);
                  const isDisabled = alreadyExists;

                  return (
                    <tr
                      key={key}
                      className="hover:bg-bg-hover"
                      style={{ opacity: isDisabled ? 0.5 : 1 }}
                    >
                      <td className="px-4 py-3 text-left text-text">
                        <input
                          type="checkbox"
                          checked={isSelected || alreadyExists}
                          disabled={isDisabled}
                          onChange={() => handleToggleModelSelection(model.id, provider.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-left text-text">{provider.name}</td>
                      <td className="px-4 py-3 text-left text-text">
                        {model.name}
                        {alreadyExists && (
                          <span
                            style={{
                              marginLeft: '8px',
                              fontSize: '11px',
                              color: 'var(--color-text-secondary)',
                              fontStyle: 'italic',
                            }}
                          >
                            (already added)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : substring ? (
          <div className="text-text-muted italic text-center text-sm py-8">
            No models found matching &quot;{substring}&quot;
          </div>
        ) : (
          <div className="text-text-muted italic text-center text-sm py-8">
            Enter a search term to find models
          </div>
        )}
      </div>
    </Modal>
  );
}
