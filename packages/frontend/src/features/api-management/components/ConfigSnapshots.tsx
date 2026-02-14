import React, { useState, useRef, useCallback } from 'react';
import {
  Save,
  RotateCcw,
  Trash2,
  Download,
  Upload,
  Clock,
  AlertTriangle,
  Check,
  X,
  FileJson,
  MoreVertical,
} from 'lucide-react';
import { useConfigSnapshots, type ConfigSnapshot } from '../hooks/useConfigSnapshots';
import { Button } from '../../../components/ui/shadcn-button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../../components/ui/shadcn-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/shadcn-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/shadcn-select';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { cn } from '../../../lib/utils';

interface ConfigSnapshotsProps {
  className?: string;
}

type SortField = 'name' | 'createdAt';
type SortOrder = 'asc' | 'desc';

export const ConfigSnapshots: React.FC<ConfigSnapshotsProps> = ({ className }) => {
  const {
    snapshots,
    loading,
    error,
    saveSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    exportSnapshot,
    importSnapshot,
  } = useConfigSnapshots();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ConfigSnapshot | null>(null);

  // Form states
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotDescription, setSnapshotDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Sorting and filtering
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');

  // Clear messages after a delay
  const clearMessages = useCallback(() => {
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 5000);
  }, []);

  // Format timestamp for display
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Get relative time
  const getRelativeTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatTimestamp(timestamp);
  };

  // Handle save snapshot
  const handleSave = async () => {
    setFormError(null);
    setActionError(null);

    if (!snapshotName.trim()) {
      setFormError('Snapshot name is required');
      return;
    }

    try {
      await saveSnapshot(snapshotName, snapshotDescription);
      setSnapshotName('');
      setSnapshotDescription('');
      setSaveModalOpen(false);
      setActionSuccess('Configuration saved successfully');
      clearMessages();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to save snapshot');
      clearMessages();
    }
  };

  // Handle restore snapshot
  const handleRestore = async () => {
    if (!selectedSnapshot) return;

    setActionError(null);
    try {
      await restoreSnapshot(selectedSnapshot.id);
      setRestoreModalOpen(false);
      setSelectedSnapshot(null);
      setActionSuccess('Configuration restored successfully');
      clearMessages();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to restore snapshot');
      clearMessages();
    }
  };

  // Handle delete snapshot
  const handleDelete = async () => {
    if (!selectedSnapshot) return;

    setActionError(null);
    try {
      await deleteSnapshot(selectedSnapshot.id);
      setDeleteModalOpen(false);
      setSelectedSnapshot(null);
      setActionSuccess('Snapshot deleted successfully');
      clearMessages();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete snapshot');
      clearMessages();
    }
  };

  // Handle export
  const handleExport = (snapshot: ConfigSnapshot) => {
    try {
      exportSnapshot(snapshot.id);
      setActionSuccess('Configuration exported successfully');
      clearMessages();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to export snapshot');
      clearMessages();
    }
  };

  // Handle file import
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setActionError(null);
    try {
      await importSnapshot(file);
      setActionSuccess('Configuration imported successfully');
      clearMessages();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to import snapshot');
      clearMessages();
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Sort and filter snapshots
  const filteredSnapshots = snapshots
    .filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  // Open restore modal
  const openRestoreModal = (snapshot: ConfigSnapshot) => {
    setSelectedSnapshot(snapshot);
    setRestoreModalOpen(true);
  };

  // Open delete modal
  const openDeleteModal = (snapshot: ConfigSnapshot) => {
    setSelectedSnapshot(snapshot);
    setDeleteModalOpen(true);
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-primary" />
              Configuration Snapshots
            </CardTitle>
            <CardDescription className="mt-1">
              Save and restore your Plexus configuration at different points in time
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
              id="import-snapshot"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSnapshotName('');
                setSnapshotDescription('');
                setFormError(null);
                setSaveModalOpen(true);
              }}
              disabled={loading}
            >
              <Save className="h-4 w-4 mr-1" />
              Save Current
            </Button>
          </div>
        </div>

        {/* Alerts */}
        {actionError && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{actionError}</span>
          </div>
        )}
        {actionSuccess && (
          <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded-lg flex items-center gap-2 text-success">
            <Check className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{actionSuccess}</span>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <Input
            placeholder="Search snapshots..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Select
              value={sortField}
              onValueChange={(value) => setSortField(value as SortField)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">Date</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="h-10 w-10"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </Button>
          </div>
        </div>

        {/* Snapshots Table */}
        {filteredSnapshots.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <FileJson className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground text-sm">
              {searchQuery ? 'No snapshots match your search' : 'No saved snapshots yet'}
            </p>
            {!searchQuery && (
              <p className="text-muted-foreground/70 text-xs mt-1">
                Save your current configuration to create your first snapshot
              </p>
            )}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSnapshots.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{snapshot.name}</span>
                        {snapshot.description && (
                          <span className="text-xs text-muted-foreground mt-0.5">
                            {snapshot.description}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        <span title={formatTimestamp(snapshot.createdAt)}>
                          {getRelativeTime(snapshot.createdAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openRestoreModal(snapshot)}
                          title="Restore"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleExport(snapshot)}
                          title="Export"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => openDeleteModal(snapshot)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Save Modal */}
      <Modal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save Configuration Snapshot"
        footer={
          <>
            <Button variant="outline" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading || !snapshotName.trim()}>
              {loading ? 'Saving...' : 'Save Snapshot'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Snapshot Name *"
            placeholder="e.g., Production Config - Jan 2024"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            error={formError || undefined}
            autoFocus
          />
          <div className="flex flex-col gap-2">
            <label className="font-body text-[13px] font-medium text-text-secondary">
              Description (optional)
            </label>
            <textarea
              className="w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)] min-h-[80px] resize-none"
              placeholder="Add notes about this configuration..."
              value={snapshotDescription}
              onChange={(e) => setSnapshotDescription(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* Restore Modal */}
      <Modal
        isOpen={restoreModalOpen}
        onClose={() => {
          setRestoreModalOpen(false);
          setSelectedSnapshot(null);
        }}
        title="Restore Configuration"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRestoreModalOpen(false);
                setSelectedSnapshot(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRestore} disabled={loading}>
              {loading ? 'Restoring...' : 'Restore'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-warning/10 border border-warning/30 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-warning">
                This will overwrite your current configuration
              </p>
              <p className="text-xs text-warning/80 mt-1">
                Are you sure you want to restore &quot;{selectedSnapshot?.name}&quot;?
                This action cannot be undone.
              </p>
            </div>
          </div>
          {selectedSnapshot && (
            <div className="text-sm text-muted-foreground">
              <p>
                <span className="font-medium">Snapshot:</span> {selectedSnapshot.name}
              </p>
              <p>
                <span className="font-medium">Created:</span>{' '}
                {formatTimestamp(selectedSnapshot.createdAt)}
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSelectedSnapshot(null);
        }}
        title="Delete Snapshot"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false);
                setSelectedSnapshot(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">
                This action cannot be undone
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                Are you sure you want to delete &quot;{selectedSnapshot?.name}&quot;?
                The snapshot will be permanently removed.
              </p>
            </div>
          </div>
        </div>
      </Modal>
    </Card>
  );
};

export default ConfigSnapshots;
