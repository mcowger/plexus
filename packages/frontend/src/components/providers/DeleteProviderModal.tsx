import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { Provider } from '../../lib/api';

interface Props {
  provider: Provider | null;
  affectedAliases: Array<{ aliasId: string; targetsCount: number }>;
  deleteModalLoading: boolean;
  onClose: () => void;
  onDelete: (cascade: boolean) => Promise<void>;
}

export function DeleteProviderModal({
  provider,
  affectedAliases,
  deleteModalLoading,
  onClose,
  onDelete,
}: Props) {
  if (!provider) return null;

  return (
    <Modal
      isOpen={!!provider}
      onClose={onClose}
      title={`Delete Provider: ${provider.name || provider.id || ''}`}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
          Choose how to delete this provider. The action cannot be undone.
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-danger)' }}>
              Delete Provider (Cascade)
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              Removes this provider AND deletes all model alias targets that reference it.
            </div>
            {affectedAliases.length > 0 ? (
              <div style={{ fontSize: '13px' }}>
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                  This will affect {affectedAliases.length} model alias(es):
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '16px',
                    fontSize: '12px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {affectedAliases.map((a) => (
                    <li key={a.aliasId}>
                      {a.aliasId} ({a.targetsCount} target(s))
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--color-text-secondary)',
                  fontStyle: 'italic',
                }}
              >
                No model aliases reference this provider.
              </div>
            )}
            <Button
              onClick={() => onDelete(true)}
              isLoading={deleteModalLoading}
              style={{ backgroundColor: 'var(--color-danger)', marginTop: 'auto' }}
            >
              Delete (Cascade)
            </Button>
          </div>
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-text)' }}>
              Delete (Retain Targets)
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              Removes only the provider. Model alias targets that reference this provider will
              remain but may cause errors.
            </div>
            {affectedAliases.length > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--color-warning)', fontStyle: 'italic' }}>
                {affectedAliases.length} model alias(es) will have orphaned targets.
              </div>
            )}
            <Button
              variant="secondary"
              onClick={() => onDelete(false)}
              isLoading={deleteModalLoading}
              style={{ marginTop: 'auto' }}
            >
              Delete (Retain)
            </Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
