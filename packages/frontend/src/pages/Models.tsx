import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { AliasMobileCard } from '../components/models/AliasMobileCard';
import { AliasTableRow } from '../components/models/AliasTableRow';
import { AutoAddModal } from '../components/models/AutoAddModal';
import { ConfirmDeleteModal } from '../components/models/ConfirmDeleteModal';
import { ImportModelsModal } from '../components/models/ImportModelsModal';
import { ModelBehaviorsEditor } from '../components/models/ModelBehaviorsEditor';
import { ModelMetadataEditor } from '../components/models/ModelMetadataEditor';
import { TargetGroupEditor } from '../components/models/TargetGroupEditor';
import { VisionFallthroughSelector } from '../components/models/VisionFallthroughSelector';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';
import { Modal } from '../components/ui/Modal';
import { SearchInput } from '../components/ui/SearchInput';
import { TagSelect } from '../components/ui/TagSelect';
import { useToast } from '../contexts/ToastContext';
import { useModels } from '../hooks/useModels';
import { Alias } from '../lib/api';
import {
  filterAndSortAliasesForModelsPage,
  getDefaultModelListSortDirection,
  getModelListProviderOptions,
  type ModelListSortDirection,
  type ModelListSortField,
} from '../lib/modelList';
import { getModelOptionKey } from '../lib/modelOptions';

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
  { type: 'decisions', label: 'Decisions', defaultOpen: false },
];

export const Models = () => {
  const toast = useToast();
  const {
    aliases,
    allAliases,
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
  const [selectedProviderFilters, setSelectedProviderFilters] = useState<string[]>([]);
  const [sortField, setSortField] = useState<ModelListSortField>('alias');
  const [sortDirection, setSortDirection] = useState<ModelListSortDirection>('asc');

  const providerOptions = useMemo(
    () => getModelListProviderOptions(allAliases, providers),
    [allAliases, providers]
  );

  // Aliases eligible as fallback targets: exclude the alias currently being
  // edited to avoid an obvious self-reference.
  const availableAliasSlugs = useMemo(
    () => allAliases.map((a) => a.id).filter((id) => id !== originalId && id !== editingAlias.id),
    [allAliases, originalId, editingAlias.id]
  );

  const visibleAliases = useMemo(
    () =>
      filterAndSortAliasesForModelsPage(
        aliases,
        providers,
        '',
        selectedProviderFilters,
        sortField,
        sortDirection
      ),
    [aliases, providers, selectedProviderFilters, sortField, sortDirection]
  );

  const handleSort = (field: ModelListSortField) => {
    if (sortField === field) {
      setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection(getDefaultModelListSortDirection(field));
  };

  const getSortAriaLabel = (field: ModelListSortField) => {
    if (sortField !== field) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

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
        const existingTargetKeys = new Set(
          prev.target_groups.flatMap((group) =>
            group.targets.map((target) => getModelOptionKey(target.provider, target.model))
          )
        );
        for (const t of targets) {
          const key = getModelOptionKey(t.provider, t.model);
          if (!existingTargetKeys.has(key)) {
            updatedTargets.push({ ...t, enabled: true });
            existingTargetKeys.add(key);
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

  const aliasesByType = MODEL_TYPE_GROUPS.map((group) => ({
    group,
    aliases: visibleAliases.filter((a) => (a.type ?? 'text') === group.type),
  }));

  const hasActiveFilters = search.trim().length > 0 || selectedProviderFilters.length > 0;
  const emptyStateMessage =
    allAliases.length === 0
      ? 'No aliases configured'
      : hasActiveFilters
        ? 'No aliases match your current search or provider filter'
        : 'No aliases found';

  return (
    <div className="flex min-h-full flex-col">
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
              disabled={allAliases.length === 0}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
          <div className="w-full sm:w-72">
            <SearchInput
              placeholder="Search by alias, upstream id, tag…"
              value={search}
              onChange={setSearch}
            />
          </div>
          <div className="w-full sm:w-80">
            <TagSelect
              label="Filter by provider"
              placeholder="All providers"
              options={providerOptions}
              selected={selectedProviderFilters}
              onChange={setSelectedProviderFilters}
            />
          </div>
          {selectedProviderFilters.length > 0 && (
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedProviderFilters([])}
                className="whitespace-nowrap"
              >
                Clear providers
              </Button>
            </div>
          )}
          <VisionFallthroughSelector aliases={allAliases} />
        </div>
      </PageHeader>

      <PageContainer>
        {visibleAliases.length === 0 ? (
          <Card className="mb-6">
            <div className="text-text-muted py-10 text-center text-sm">{emptyStateMessage}</div>
          </Card>
        ) : (
          <div className="mb-6 flex flex-col gap-3">
            {aliasesByType.map(({ group, aliases: groupAliases }) => (
              <Disclosure
                key={group.type}
                title={
                  <span className="flex items-center gap-2">
                    <span>{group.label}</span>
                    <span className="text-text-muted text-xs font-normal">
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
                  <table className="font-body w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          aria-sort={getSortAriaLabel('alias')}
                          className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
                          style={{ paddingLeft: '24px' }}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort('alias')}
                            className="hover:text-text inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Alias</span>
                            {sortField === 'alias' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp size={12} aria-hidden="true" />
                              ) : (
                                <ArrowDown size={12} aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={getSortAriaLabel('provider')}
                          className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
                        >
                          <button
                            type="button"
                            onClick={() => handleSort('provider')}
                            className="hover:text-text inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Provider</span>
                            {sortField === 'provider' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp size={12} aria-hidden="true" />
                              ) : (
                                <ArrowDown size={12} aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={getSortAriaLabel('targets')}
                          className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
                          style={{ paddingRight: '24px' }}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort('targets')}
                            className="hover:text-text inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Targets</span>
                            {sortField === 'targets' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp size={12} aria-hidden="true" />
                              ) : (
                                <ArrowDown size={12} aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" aria-hidden="true" />
                            )}
                          </button>
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
                <label className="font-body text-text-secondary text-[13px] font-medium">
                  Primary Name (ID)
                </label>
                <input
                  className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border px-3 py-2 text-sm backdrop-blur-md transition-all duration-200 outline-none focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                  value={editingAlias.id}
                  onChange={(e) => setEditingAlias({ ...editingAlias, id: e.target.value })}
                  placeholder="e.g. gpt-4-turbo"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-body text-text-secondary text-[13px] font-medium">
                  Model Type
                </label>
                <select
                  className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border px-3 py-2 text-sm backdrop-blur-md transition-all duration-200 outline-none focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                  value={editingAlias.type ?? 'text'}
                  onChange={(e) =>
                    setEditingAlias({
                      ...editingAlias,
                      type: e.target.value as
                        'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'decisions',
                    })
                  }
                >
                  <option value="text">Text</option>
                  <option value="embeddings">Embeddings</option>
                  <option value="transcriptions">Transcriptions</option>
                  <option value="speech">Speech</option>
                  <option value="image">Image</option>
                  <option value="decisions">Decisions</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-body text-text-secondary text-[13px] font-medium">
                  Priority
                </label>
                <select
                  className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border px-3 py-2 text-sm backdrop-blur-md transition-all duration-200 outline-none focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
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

            <p className="text-text-muted text-xs" style={{ marginTop: '-4px' }}>
              Priority: &ldquo;Selector&rdquo; uses the strategy above. &ldquo;API Match&rdquo;
              matches provider type to incoming request format.
            </p>

            <div className="bg-border-glass h-px" style={{ margin: '4px 0' }}></div>

            {/* Additional Aliases disclosure */}
            <div className="border-border-glass overflow-hidden rounded-sm border">
              <button
                type="button"
                onClick={() => setIsAliasesOpen((o) => !o)}
                className="bg-bg-subtle hover:bg-bg-hover flex w-full items-center justify-between px-3 py-2 text-left transition-colors duration-150"
              >
                <span className="font-body text-text-secondary text-[13px] font-medium">
                  Additional Aliases
                </span>
                {isAliasesOpen ? (
                  <ChevronDown size={14} className="text-text-muted" />
                ) : (
                  <ChevronRight size={14} className="text-text-muted" />
                )}
              </button>
              {isAliasesOpen && (
                <div className="border-border-glass flex flex-col gap-1 border-t px-3 py-3">
                  {(!editingAlias.aliases || editingAlias.aliases.length === 0) && (
                    <div className="text-text-muted py-1 text-center text-sm italic">
                      No additional aliases
                    </div>
                  )}
                  {editingAlias.aliases?.map((alias, idx) => (
                    <div key={idx} className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          className="font-body text-text bg-bg-glass border-border-glass focus:border-primary h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none outline-none"
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
                        className="text-danger px-1 opacity-60 hover:opacity-100"
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

            <div className="bg-border-glass h-px" style={{ margin: '4px 0' }}></div>

            {/* Metadata accordion */}
            <ModelMetadataEditor
              editingAlias={editingAlias}
              setEditingAlias={setEditingAlias}
              isModalOpen={isModalOpen}
            />

            <div className="bg-border-glass h-px" style={{ margin: '4px 0' }}></div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="font-body text-text-secondary text-[13px] font-medium">
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
                availableAliases={availableAliasSlugs}
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
              This will permanently remove <strong>{allAliases.length}</strong> model alias
              {allAliases.length !== 1 ? 'es' : ''} from the configuration.
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
