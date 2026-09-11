import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface McpDeleteLogModalProps {
  isOpen: boolean;
  isDeletingLogs: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function McpDeleteLogModal({
  isOpen,
  isDeletingLogs,
  onClose,
  onConfirm,
}: McpDeleteLogModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm Deletion"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isDeletingLogs}>
            {isDeletingLogs ? 'Deleting...' : 'Delete Log'}
          </Button>
        </>
      }
    >
      <p>Are you sure you want to delete this MCP log entry?</p>
    </Modal>
  );
}
