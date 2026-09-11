import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface McpDeleteLogsModalProps {
  isOpen: boolean;
  deleteLogsMode: 'all' | 'older';
  olderThanDays: number;
  isDeletingLogs: boolean;
  onClose: () => void;
  onModeChange: (mode: 'all' | 'older') => void;
  onOlderThanDaysChange: (days: number) => void;
  onConfirm: () => void | Promise<void>;
}

export function McpDeleteLogsModal({
  isOpen,
  deleteLogsMode,
  olderThanDays,
  isDeletingLogs,
  onClose,
  onModeChange,
  onOlderThanDaysChange,
  onConfirm,
}: McpDeleteLogsModalProps) {
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
            {isDeletingLogs ? 'Deleting...' : 'Delete Logs'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p>Select which MCP logs you would like to delete:</p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="radio"
            id="mcp-delete-older"
            name="deleteLogsMode"
            checked={deleteLogsMode === 'older'}
            onChange={() => onModeChange('older')}
          />
          <label htmlFor="mcp-delete-older">Delete logs older than</label>
          <Input
            type="number"
            min="1"
            value={olderThanDays}
            onChange={(e) => onOlderThanDaysChange(parseInt(e.target.value) || 1)}
            style={{ width: '60px', padding: '4px 8px' }}
            disabled={deleteLogsMode !== 'older'}
          />
          <span>days</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="radio"
            id="mcp-delete-all"
            name="deleteLogsMode"
            checked={deleteLogsMode === 'all'}
            onChange={() => onModeChange('all')}
          />
          <label htmlFor="mcp-delete-all" style={{ color: 'var(--color-danger)' }}>
            Delete ALL logs (Cannot be undone)
          </label>
        </div>
      </div>
    </Modal>
  );
}
