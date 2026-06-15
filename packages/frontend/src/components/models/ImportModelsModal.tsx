import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { OrphanGroup } from '../../hooks/useModels';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orphanGroups: OrphanGroup[];
  selectedImports: Map<string, Set<string>>;
  setSelectedImports: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
  selectedModels: Set<string>;
  setSelectedModels: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedAliases: Map<string, string>;
  setSelectedAliases: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  onSuppress: (modelId: string) => void;
  onUnsuppressAll: () => void;
  hasSuppressedModels: boolean;
  onImport: () => Promise<boolean>;
  isImporting: boolean;
}

export function ImportModelsModal({
  isOpen,
  onClose,
  orphanGroups,
  selectedImports,
  setSelectedImports,
  selectedModels,
  setSelectedModels,
  selectedAliases,
  setSelectedAliases,
  onSuppress,
  onUnsuppressAll,
  hasSuppressedModels,
  onImport,
  isImporting,
}: Props) {
  const hasSelectedImport = orphanGroups.some(
    (group) =>
      selectedModels.has(group.modelId) && (selectedImports.get(group.modelId)?.size ?? 0) > 0
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Orphaned Models"
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onImport}
            isLoading={isImporting}
            disabled={!hasSelectedImport || orphanGroups.length === 0}
          >
            Import Selected
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onUnsuppressAll}
            disabled={!hasSuppressedModels}
          >
            Unsuppress all
          </Button>
        </div>
        {orphanGroups.length === 0 ? (
          <div className="text-text-muted italic text-center text-sm py-8">
            No orphaned models found. All provider models are covered by aliases or suppressed
            locally.
          </div>
        ) : (
          <div
            style={{
              maxHeight: '500px',
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
                    {' '}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Model / Alias
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Providers
                  </th>
                  <th
                    className="px-4 py-3 text-right font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                    style={{ width: '110px' }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {orphanGroups.map((group) => {
                  const selected = selectedImports.get(group.modelId) || new Set<string>();
                  const isModelSelected = selectedModels.has(group.modelId);
                  const selectedAliasId = selectedAliases.get(group.modelId) ?? '';

                  return (
                    <tr key={group.modelId} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-left text-text">
                        <input
                          type="checkbox"
                          checked={isModelSelected}
                          onChange={(e) => {
                            const next = new Set(selectedModels);
                            if (e.target.checked) {
                              next.add(group.modelId);
                            } else {
                              next.delete(group.modelId);
                            }
                            setSelectedModels(next);
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-left text-text">
                        <div className="font-medium">{group.modelId}</div>
                        {group.aliasMatches.length > 0 ? (
                          <>
                            <span className="inline-flex rounded border border-border-glass px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                              Existing Alias Match
                            </span>
                            {group.aliasMatches.length === 1 ? (
                              <div className="text-[11px] text-text-muted mt-0.5">
                                {group.aliasMatches[0].alias.id} · {group.aliasMatches[0].reason}
                              </div>
                            ) : (
                              <select
                                className="mt-1 w-full max-w-xs py-1 px-2 font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                                value={selectedAliasId}
                                onChange={(e) => {
                                  const next = new Map(selectedAliases);
                                  if (e.target.value) {
                                    next.set(group.modelId, e.target.value);
                                  } else {
                                    next.delete(group.modelId);
                                  }
                                  setSelectedAliases(next);
                                }}
                              >
                                <option value="">Create new alias</option>
                                {group.aliasMatches.map((match) => (
                                  <option key={match.alias.id} value={match.alias.id}>
                                    {match.alias.id} ({match.reason})
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        ) : (
                          <span className="inline-flex rounded border border-border-glass px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            New Alias
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-left">
                        <div className="flex flex-col gap-1">
                          {group.candidates.map((c) => {
                            const isChecked = selected.has(c.provider.id);
                            return (
                              <label
                                key={c.provider.id}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    const next = new Map(selectedImports);
                                    const current = new Set(next.get(group.modelId) || []);
                                    if (current.has(c.provider.id)) {
                                      current.delete(c.provider.id);
                                    } else {
                                      current.add(c.provider.id);
                                    }
                                    next.set(group.modelId, current);
                                    setSelectedImports(next);
                                  }}
                                />
                                <span className="text-text text-[13px]">
                                  {c.provider.name}
                                  {c.model.id !== group.modelId && (
                                    <span className="text-text-muted ml-1 text-[11px]">
                                      ({c.model.id})
                                    </span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => onSuppress(group.modelId)}>
                          Suppress
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
