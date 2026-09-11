import type { ChangeEvent, RefObject } from 'react';
import { AlertTriangle, Archive, HardDrive, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface BackupRestoreCardProps {
  restoreInputRef: RefObject<HTMLInputElement | null>;
  restoreLoading: boolean;
  fullBackupLoading: boolean;
  backupLoading: boolean;
  resetLogsLoading: boolean;
  onRestoreClick: () => void;
  onRestoreFileSelect: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onFullBackupDownload: () => void;
  onBackupDownload: () => void;
  onResetLogs: () => void;
}

export function BackupRestoreCard({
  restoreInputRef,
  restoreLoading,
  fullBackupLoading,
  backupLoading,
  resetLogsLoading,
  onRestoreClick,
  onRestoreFileSelect,
  onFullBackupDownload,
  onBackupDownload,
  onResetLogs,
}: BackupRestoreCardProps) {
  return (
    <Card title="Backup & Restore">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 mr-1">
          <AlertTriangle size={13} className="text-warning shrink-0" />
          <span className="font-body text-[11px] text-text-muted">
            Sensitive data — store securely
          </span>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={onRestoreClick}
          isLoading={restoreLoading}
          leftIcon={<Upload size={14} />}
        >
          Restore
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onFullBackupDownload}
          isLoading={fullBackupLoading}
          leftIcon={<Archive size={14} />}
        >
          Full Backup
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onBackupDownload}
          isLoading={backupLoading}
          leftIcon={<HardDrive size={14} />}
        >
          Config Backup
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onResetLogs}
          isLoading={resetLogsLoading}
          leftIcon={<Trash2 size={14} />}
        >
          Reset All Logs
        </Button>
        <input
          ref={restoreInputRef}
          type="file"
          accept=".json,.tar.gz,.tgz,application/gzip,application/x-gzip,application/octet-stream"
          className="hidden"
          onChange={onRestoreFileSelect}
        />
      </div>
    </Card>
  );
}
