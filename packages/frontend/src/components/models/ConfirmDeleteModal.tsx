import React from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  isLoading: boolean;
}

export function ConfirmDeleteModal({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  isLoading,
}: Props) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} isLoading={isLoading} variant="danger">
            {confirmLabel}
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
            {title === 'Delete Model Alias'
              ? 'Are you sure you want to delete this alias?'
              : 'Are you sure you want to delete all configured models?'}
          </p>
          <p className="text-text-secondary" style={{ fontSize: '14px' }}>
            {message}
          </p>
        </div>
      </div>
    </Modal>
  );
}
