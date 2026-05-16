import React from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  variant?: 'single' | 'all';
  onConfirm: () => Promise<void> | void;
  isLoading: boolean;
}

export function ConfirmDeleteModal({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel,
  variant = 'single',
  onConfirm,
  isLoading,
}: Props) {
  const { t: tc } = useT('common');
  const { t } = useT('models.confirmDelete');

  const confirmActionLabel = confirmLabel ?? tc('delete');
  const promptText = variant === 'all' ? t('promptAll') : t('promptSingle');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {tc('cancel')}
          </Button>
          <Button onClick={onConfirm} isLoading={isLoading} variant="danger">
            {confirmActionLabel}
          </Button>
        </div>
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          alignItems: 'center',
          textAlign: 'center',
          padding: '16px 0',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trash2 size={24} style={{ color: 'var(--color-danger)' }} />
        </div>
        <div>
          <p className="text-text" style={{ marginBottom: '8px', fontWeight: 500 }}>
            {promptText}
          </p>
          <p className="text-text-secondary" style={{ fontSize: '14px' }}>
            {message}
          </p>
        </div>
      </div>
    </Modal>
  );
}
