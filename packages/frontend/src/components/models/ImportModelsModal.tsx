import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { OrphanGroup } from '../../hooks/useModels';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orphanGroups: OrphanGroup[];
  selectedImports: Map<string, Set<string>>;
  setSelectedImports: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
  onImport: () => Promise<boolean>;
  isImporting: boolean;
}

export function ImportModelsModal({
  isOpen,
  onClose,
  orphanGroups,
  selectedImports,
  setSelectedImports,
  onImport,
  isImporting,
}: Props) {
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
            disabled={
              Array.from(selectedImports.values()).every((providerIds) => providerIds.size === 0) ||
              orphanGroups.length === 0
            }
          >
            Import Selected
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {orphanGroups.length === 0 ? (
          <div className="text-text-muted italic text-center text-sm py-8">
            No orphaned models found — all provider models are covered by aliases.
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
                </tr>
              </thead>
              <tbody>
                {orphanGroups.map((group) => {
                  const selected = selectedImports.get(group.modelId) || new Set<string>();
                  const allChecked =
                    group.candidates.length > 0 &&
                    group.candidates.every((c) => selected.has(c.provider.id));

                  return (
                    <tr key={group.modelId} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-left text-text">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={(e) => {
                            const next = new Map(selectedImports);
                            if (e.target.checked) {
                              next.set(
                                group.modelId,
                                new Set(group.candidates.map((c) => c.provider.id))
                              );
                            } else {
                              next.set(group.modelId, new Set<string>());
                            }
                            setSelectedImports(next);
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-left text-text">
                        <div className="font-medium">{group.modelId}</div>
                        {group.existingAlias ? (
                          <>
                            <span className="inline-flex rounded border border-border-glass px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                              Existing Alias
                            </span>
                            {group.matchReason && (
                              <div className="text-[11px] text-text-muted mt-0.5">
                                {group.matchReason}
                              </div>
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
