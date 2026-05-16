import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { Provider } from '../../lib/api';
import { useT } from '../../i18n/useT';

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
  const { t } = useT('providers.delete');
  const { t: tc } = useT('common');

  if (!provider) return null;

  const nameOrId = provider.name || provider.id || '';

  return (
    <Modal
      isOpen={!!provider}
      onClose={onClose}
      title={t('title', { name: nameOrId })}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>{t('intro')}</div>
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
              {t('cascadeTitle')}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              {t('cascadeBody')}
            </div>
            {affectedAliases.length > 0 ? (
              <div style={{ fontSize: '13px' }}>
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                  {t('affected', { count: affectedAliases.length })}
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
                      {t('targetCount', { aliasId: a.aliasId, count: a.targetsCount })}
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
                {t('noAliases')}
              </div>
            )}
            <Button
              onClick={() => onDelete(true)}
              isLoading={deleteModalLoading}
              style={{ backgroundColor: 'var(--color-danger)', marginTop: 'auto' }}
            >
              {t('cascadeButton')}
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
              {t('retainTitle')}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              {t('retainBody')}
            </div>
            {affectedAliases.length > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--color-warning)', fontStyle: 'italic' }}>
                {t('orphaned', { count: affectedAliases.length })}
              </div>
            )}
            <Button
              variant="secondary"
              onClick={() => onDelete(false)}
              isLoading={deleteModalLoading}
              style={{ marginTop: 'auto' }}
            >
              {t('retainButton')}
            </Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
