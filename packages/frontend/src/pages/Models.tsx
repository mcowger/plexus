import { useState, useCallback } from 'react';
import { Alias } from '../lib/api';
import { useModels } from '../hooks/useModels';
import { AliasTableRow } from '../components/models/AliasTableRow';
import { AliasMobileCard } from '../components/models/AliasMobileCard';
import { TargetGroupEditor } from '../components/models/TargetGroupEditor';
import { ModelBehaviorsEditor } from '../components/models/ModelBehaviorsEditor';
import { ModelMetadataEditor } from '../components/models/ModelMetadataEditor';
import { AutoAddModal } from '../components/models/AutoAddModal';
import { ImportModelsModal } from '../components/models/ImportModelsModal';
import { ConfirmDeleteModal } from '../components/models/ConfirmDeleteModal';
import { VisionFallthroughSelector } from '../components/models/VisionFallthroughSelector';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchInput } from '../components/ui/SearchInput';
import { Disclosure } from '../components/ui/Disclosure';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { useToast } from '../contexts/ToastContext';
import { Plus, Trash2, Zap, Download, ChevronDown, ChevronRight } from 'lucide-react';

// Model alias types grouped into accordions on the Models page. Order
// follows rough frequency of use.
type ModelTypeGroup = {
  type: NonNullable<Alias['type']>;
  label: string;
  defaultOpen: boolean;
};

const MODEL_TYPE_GROUPS: ModelTypeGroup[] = [
  { type: 'text', label: 'Text', defaultOpen: true },
  { type: 'embeddings', label: 'Embeddings', defaultOpen: false },
  { type: 'transcriptions', label: 'Transcriptions', defaultOpen: false },
  { type: 'speech', label: 'Speech', defaultOpen: false },
  { type: 'image', label: 'Image', defaultOpen: false },
];

export const Models = () => {
  const toast = useToast();
  const {
    aliases,
    providers,
    availableModels,
    cooldowns,
    search,
    setSearch,
    isModalOpen,
    setIsModalOpen,
    editingAlias,
    setEditingAlias,
    originalId,
    isSaving,
    testStates,
    handleEdit,
    handleAddNew,
    handleSave: hookSave,
    handleDelete: hookDelete,
    handleDeleteAll: hookDeleteAll,
    handleToggleTarget,
    handleTestTarget,
    dismissTestMessage,
    isImportModalOpen,
    setIsImportModalOpen,
    orphanGroups,
    selectedImports,
    setSelectedImports,
    selectedImportModels,
    setSelectedImportModels,
    selectedImportAliases,
    setSelectedImportAliases,
    hasSuppressedImportModels,
    isImporting,
    handleOpenImport,
    handleSuppressImportModel,
    handleUnsuppressAllImportModels,
    handleSaveImports,
  } = useModels();

  // Delete Confirmation State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [aliasToDelete, setAliasToDelete] = useState<Alias | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Auto Add Modal State
  const [isAutoAddModalOpen, setIsAutoAddModalOpen] = useState(false);
  const [isAliasesOpen, setIsAliasesOpen] = useState(false);

  // Edit modal accordion toggles — architecture & metadata manage their own
  // in child components, but behaviors has no parent-provided toggle.
  // All three accordions are self-contained; we keep this import only for
  // the unified Modal layout below.

  const handleSave = async () => {
    if (!editingAlias.id) return;
    if (editingAlias.metadata?.source === 'custom') {
      const name = editingAlias.metadata.overrides?.name;
      if (!name || name.trim() === '') {
        toast.error('Custom metadata requires a non-empty Name.');
        return;
      }
    }
    await hookSave(editingAlias, originalId);
  };

  const handleDeleteClick = (alias: Alias) => {
    setAliasToDelete(alias);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!aliasToDelete) return;
    setIsDeleting(true);
    const success = await hookDelete(aliasToDelete.id);
    if (success) {
      setIsDeleteModalOpen(false);
      setAliasToDelete(null);
    }
    setIsDeleting(false);
  };

  const handleConfirmDeleteAll = async () => {
    setIsDeletingAll(true);
    const success = await hookDeleteAll();
    if (success) {
      setIsDeleteAllModalOpen(false);
    }
    setIsDeletingAll(false);
  };

  const handleAutoAddTargets = useCallback(
    (targets: Array<{ provider: string; model: string }>) => {
      setEditingAlias((prev: Alias) => {
        const updatedTargets = [...(prev.target_groups[0]?.targets ?? [])];
        for (const t of targets) {
          const alreadyExists = updatedTargets.some(
            (x: { provider: string; model: string }) =>
              x.provider === t.provider && x.model === t.model
          );
          if (!alreadyExists) {
            updatedTargets.push({ ...t, enabled: true });
          }
        }
        const groups = [...prev.target_groups];
        groups[0] = { ...groups[0], targets: updatedTargets };
        return { ...prev, target_groups: groups };
      });
      setIsAutoAddModalOpen(false);
    },
    [setEditingAlias]
  );

  const sortedAliases = [...aliases].sort((a, b) => a.id.localeCompare(b.id));

  // Bucket the (already search-filtered) aliases into the ordered type groups.
  const aliasesByType = MODEL_TYPE_GROUPS.map((group) => ({
    group,
    aliases: sortedAliases.filter((a) => (a.type ?? 'text') === group.type),
  }));

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Models"
        subtitle="Aliases that map gateway models to upstream provider models"
        actions={
          <>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Trash2 size={14} />}
              onClick={() => setIsDeleteAllModalOpen(true)}
              disabled={aliases.length === 0}
            >
              Delete All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download size={14} />}
              onClick={handleOpenImport}
            >
              Import
            </Button>
            <Button leftIcon={<Plus size={14} />} onClick={handleAddNew} size="sm">
              Add model
            </Button>
          </>
        }
      >
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-center">
          <div className="w-full sm:w-72">
            <SearchInput
              placeholder="Search by alias, upstream id, tag…"
              value={search}
              onChange={setSearch}
            />
          </div>
          <VisionFallthroughSelector aliases={aliases} />
        </div>
      </PageHeader>

      <PageContainer>
        {sortedAliases.length === 0 ? (
          <Card className="mb-6">
            <div className="py-10 text-center text-sm text-text-muted">No aliases found</div>
          </Card>
        ) : (
          <div className="flex flex-col gap-3 mb-6">
            {aliasesByType.map(({ group, aliases: groupAliases }) => (
              <Disclosure
                key={group.type}
                title={
                  <span className="flex items-center gap-2">
                    <span>{group.label}</span>
                    <span className="text-xs font-normal text-text-muted">
                      {groupAliases.length}
                    </span>
                  </span>
                }
                defaultOpen={group.defaultOpen}
              >
                {/* Mobile cards */}
                <div className="space-y-3 md:hidden">
                  {groupAliases.map((alias) => (
                    <AliasMobileCard
                      key={alias.id}
                      alias={alias}
                      providers={providers}
                      cooldowns={cooldowns}
                      testStates={testStates}
                      onEdit={handleEdit}
                      onDelete={handleDeleteClick}
                      onToggleTarget={handleToggleTarget}
                      onTestTarget={handleTestTarget}
                      onDismissTestMessage={dismissTestMessage}
                    />
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse font-body text-[13px]">
                    <thead>
                      <tr>
                        <th
                          className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                          style={{ paddingLeft: '24px' }}
                        >
                          Alias
                        </th>
                        <th
                          className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                          style={{ paddingRight: '24px' }}
                        >
                          Targets
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupAliases.map((alias) => (
                        <AliasTableRow
                          key={alias.id}
                          alias={alias}
                          providers={providers}
                          cooldowns={cooldowns}
                          testStates={testStates}
                          onEdit={handleEdit}
                          onDelete={handleDeleteClick}
                          onToggleTarget={handleToggleTarget}
                          onTestTarget={handleTestTarget}
                          onDismissTestMessage={dismissTestMessage}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Disclosure>
            ))}
          </div>
        )}

        {/* Edit / Add Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={originalId ? 'Edit Model' : 'Add Model'}
          size="lg"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} isLoading={isSaving}>
                Save Changes
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '-8px' }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Primary Name (ID)
                </label>
                <input
                  className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                  value={editingAlias.id}
                  onChange={(e) => setEditingAlias({ ...editingAlias, id: e.target.value })}
                  placeholder="e.g. gpt-4-turbo"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Model Type
                </label>
                <select
                  className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                  value={editingAlias.type ?? 'text'}
                  onChange={(e) =>
                    setEditingAlias({
                      ...editingAlias,
                      type: e.target.value as
                        | 'text'
                        | 'embeddings'
                        | 'transcriptions'
                        | 'speech'
                        | 'image',
                    })
                  }
                >
                  <option value="text">Text</option>
                  <option value="embeddings">Embeddings</option>
                  <option value="transcriptions">Transcriptions</option>
                  <option value="speech">Speech</option>
                  <option value="image">Image</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Priority
                </label>
                <select
                  className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                  value={editingAlias.priority || 'selector'}
                  onChange={(e) =>
                    setEditingAlias({ ...editingAlias, priority: e.target.value as any })
                  }
                >
                  <option value="selector">Selector</option>
                  <option value="api_match">API Match</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-text-muted" style={{ marginTop: '-4px' }}>
              Priority: &ldquo;Selector&rdquo; uses the strategy above. &ldquo;API Match&rdquo;
              matches provider type to incoming request format.
            </p>

            <div className="h-px bg-border-glass" style={{ margin: '4px 0' }}></div>

            {/* Additional Aliases disclosure */}
            <div className="border border-border-glass rounded-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setIsAliasesOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
              >
                <span className="font-body text-[13px] font-medium text-text-secondary">
                  Additional Aliases
                </span>
                {isAliasesOpen ? (
                  <ChevronDown size={14} className="text-text-muted" />
                ) : (
                  <ChevronRight size={14} className="text-text-muted" />
                )}
              </button>
              {isAliasesOpen && (
                <div className="px-3 py-3 border-t border-border-glass flex flex-col gap-1">
                  {(!editingAlias.aliases || editingAlias.aliases.length === 0) && (
                    <div className="text-text-muted italic text-center text-sm py-1">
                      No additional aliases
                    </div>
                  )}
                  {editingAlias.aliases?.map((alias, idx) => (
                    <div key={idx} className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          className="w-full h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                          value={alias}
                          onChange={(e) => {
                            const next = [...(editingAlias.aliases || [])];
                            next[idx] = e.target.value;
                            setEditingAlias({ ...editingAlias, aliases: next });
                          }}
                          placeholder="e.g. gpt4"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(editingAlias.aliases || [])];
                          next.splice(idx, 1);
                          setEditingAlias({ ...editingAlias, aliases: next });
                        }}
                        className="text-danger opacity-60 hover:opacity-100 px-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-1 w-fit"
                    onClick={() =>
                      setEditingAlias({
                        ...editingAlias,
                        aliases: [...(editingAlias.aliases || []), ''],
                      })
                    }
                    leftIcon={<Plus size={14} />}
                  >
                    Add Alias
                  </Button>
                </div>
              )}
            </div>

            {/* Advanced accordion (behaviors + architecture) */}
            <ModelBehaviorsEditor editingAlias={editingAlias} setEditingAlias={setEditingAlias} />

            <div className="h-px bg-border-glass" style={{ margin: '4px 0' }}></div>

            {/* Metadata accordion */}
            <ModelMetadataEditor
              editingAlias={editingAlias}
              setEditingAlias={setEditingAlias}
              isModalOpen={isModalOpen}
            />

            <div className="h-px bg-border-glass" style={{ margin: '4px 0' }}></div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Target Groups
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsAutoAddModalOpen(true)}
                    leftIcon={<Zap size={14} />}
                  >
                    Auto Add
                  </Button>
                </div>
              </div>

              <TargetGroupEditor
                groups={editingAlias.target_groups}
                providers={providers}
                availableModels={availableModels}
                onChange={(groups) => setEditingAlias({ ...editingAlias, target_groups: groups })}
              />
            </div>
          </div>
        </Modal>

        {/* Auto Add Modal */}
        <AutoAddModal
          isOpen={isAutoAddModalOpen}
          onClose={() => setIsAutoAddModalOpen(false)}
          providers={providers}
          availableModels={availableModels}
          targetGroups={editingAlias.target_groups}
          onAddTargets={handleAutoAddTargets}
          preFillQuery={editingAlias.id || ''}
        />

        {/* Import Modal */}
        <ImportModelsModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          orphanGroups={orphanGroups}
          selectedImports={selectedImports}
          setSelectedImports={setSelectedImports}
          selectedModels={selectedImportModels}
          setSelectedModels={setSelectedImportModels}
          selectedAliases={selectedImportAliases}
          setSelectedAliases={setSelectedImportAliases}
          onSuppress={handleSuppressImportModel}
          onUnsuppressAll={handleUnsuppressAllImportModels}
          hasSuppressedModels={hasSuppressedImportModels}
          onImport={handleSaveImports}
          isImporting={isImporting}
        />

        {/* Delete All Modal */}
        <ConfirmDeleteModal
          isOpen={isDeleteAllModalOpen}
          onClose={() => setIsDeleteAllModalOpen(false)}
          title="Delete All Models"
          message={
            <>
              This will permanently remove <strong>{aliases.length}</strong> model alias
              {aliases.length !== 1 ? 'es' : ''} from the configuration.
            </>
          }
          confirmLabel="Delete All"
          onConfirm={handleConfirmDeleteAll}
          isLoading={isDeletingAll}
        />

        {/* Delete Single Modal */}
        <ConfirmDeleteModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          title="Delete Model Alias"
          message={
            <>
              <strong>{aliasToDelete?.id}</strong> will be permanently removed from the
              configuration.
            </>
          }
          onConfirm={handleConfirmDelete}
          isLoading={isDeleting}
        />
      </PageContainer>
    </div>
  );
};
