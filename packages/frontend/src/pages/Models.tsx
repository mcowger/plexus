import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  Alias,
  AliasMetadata,
  AliasBehavior,
  MetadataOverrides,
  MetadataSource,
  NormalizedModelMetadata,
  Provider,
  Model,
} from '../lib/api';
import { useModels } from '../hooks/useModels';
import { AliasTableRow } from '../components/models/AliasTableRow';
import { MetadataOverrideForm } from '../components/models/MetadataOverrideForm';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  Zap,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  BookOpen,
  X,
  CheckCircle,
  GripVertical,
  Save,
  Eye,
} from 'lucide-react';

export const Models = () => {
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
  } = useModels();

  // Modal State
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  // "Override" toggle for non-custom sources. When on, the editable field
  // grid is shown so the user can override individual enriched fields.
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);

  // Metadata search state
  const [metadataQuery, setMetadataQuery] = useState('');
  const [metadataResults, setMetadataResults] = useState<{ id: string; name: string }[]>([]);
  const [isMetadataSearching, setIsMetadataSearching] = useState(false);
  const [showMetadataDropdown, setShowMetadataDropdown] = useState(false);
  const metadataSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataInputWrapperRef = useRef<HTMLDivElement | null>(null);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Delete Confirmation State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [aliasToDelete, setAliasToDelete] = useState<Alias | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Auto Add Modal State
  const [isAutoAddModalOpen, setIsAutoAddModalOpen] = useState(false);
  const [substring, setSubstring] = useState('');
  const [filteredModels, setFilteredModels] = useState<Array<{ model: Model; provider: Provider }>>(
    []
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  // Drag and Drop State
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Global Descriptor State
  const [globalDescriptorModel, setGlobalDescriptorModel] = useState('');
  const [isSavingDescriptor, setIsSavingDescriptor] = useState(false);

  // Reference values used by `countOverrides` to distinguish genuine overrides
  // from fields that merely mirror the auto-populated catalog values.
  //   undefined -> catalog lookup hasn't resolved yet (or not applicable)
  //   null      -> lookup failed / no catalog record (treat as empty reference)
  //   object    -> loaded catalog values, converted to the overrides shape
  const [catalogReference, setCatalogReference] = useState<MetadataOverrides | null | undefined>(
    undefined
  );

  useEffect(() => {
    const fetchVFConfig = async () => {
      try {
        const config = await api.getVisionFallthroughConfig();
        if (config?.descriptor_model) {
          setGlobalDescriptorModel(config.descriptor_model);
        }
      } catch (e) {
        console.error('Failed to load VF config', e);
      }
    };
    fetchVFConfig();
  }, []);

  // When the modal opens, sync override panel state + search query with the
  // current alias's metadata block.
  useEffect(() => {
    if (!isModalOpen) return;
    // Cancel any debounce left over from the previous modal session so it
    // can't land results against the newly-loaded alias.
    cancelMetadataDebounce();
    const meta = editingAlias.metadata;
    setIsOverrideOpen(!!meta && (meta.source === 'custom' || !!meta.overrides));
    setMetadataQuery(meta?.source_path ?? '');
    setShowMetadataDropdown(false);
    setMetadataResults([]);
    setIsMetadataSearching(false);
    // Only re-run when the modal transitions open (or editingAlias.id changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, editingAlias.id]);

  const handleSaveDescriptor = async () => {
    setIsSavingDescriptor(true);
    try {
      await api.updateVisionFallthroughConfig({
        descriptor_model: globalDescriptorModel,
      });
    } catch (e) {
      console.error('Failed to save descriptor model', e);
    } finally {
      setIsSavingDescriptor(false);
    }
  };

  const handleSave = async () => {
    if (!editingAlias.id) return;
    // Custom metadata requires a non-empty name — the backend Zod schema will
    // reject it otherwise. Surface a clear error here instead of letting the
    // save API call fail generically.
    if (editingAlias.metadata?.source === 'custom') {
      const name = editingAlias.metadata.overrides?.name;
      if (!name || name.trim() === '') {
        alert('Custom metadata requires a non-empty Name.');
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

  const updateTarget = (
    index: number,
    field: 'provider' | 'model' | 'enabled',
    value: string | boolean
  ) => {
    const newTargets = [...editingAlias.targets];
    // When provider changes, clear model
    if (field === 'provider') {
      newTargets[index] = {
        provider: value as string,
        model: '',
        enabled: newTargets[index].enabled,
      };
    } else if (field === 'enabled') {
      newTargets[index] = { ...newTargets[index], enabled: value as boolean };
    } else if (field === 'model') {
      newTargets[index] = { ...newTargets[index], model: value as string };
    }
    setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const moveTarget = (index: number, direction: 'up' | 'down') => {
    const newTargets = [...editingAlias.targets];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newTargets.length) return;

    const [movedItem] = newTargets.splice(index, 1);
    newTargets.splice(newIndex, 0, movedItem);
    setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const addTarget = () => {
    setEditingAlias({
      ...editingAlias,
      targets: [...editingAlias.targets, { provider: '', model: '', enabled: true }],
    });
  };

  const removeTarget = (index: number) => {
    const newTargets = [...editingAlias.targets];
    newTargets.splice(index, 1);
    setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const handleSearchModels = (query?: string) => {
    const searchTerm = query !== undefined ? query : substring;
    if (!searchTerm.trim()) {
      setFilteredModels([]);
      return;
    }

    const searchLower = searchTerm.toLowerCase();

    const matches: Array<{ model: Model; provider: Provider }> = [];
    availableModels.forEach((model) => {
      const provider = providers.find((p) => p.id === model.providerId);
      if (
        provider &&
        (model.name.toLowerCase().includes(searchLower) ||
          provider.name.toLowerCase().includes(searchLower))
      ) {
        matches.push({ model, provider: { ...provider } });
      }
    });

    setFilteredModels(matches);
  };

  const handleOpenAutoAdd = () => {
    const query = editingAlias.id || '';
    setSubstring(query);
    setSelectedModels(new Set());
    setIsAutoAddModalOpen(true);
    // Run search immediately with the pre-filled query so results appear
    // without requiring a manual button click (fixes #148).
    handleSearchModels(query);
  };

  const handleToggleModelSelection = (modelId: string, providerId: string) => {
    const key = `${providerId}|${modelId}`;
    const newSelection = new Set(selectedModels);
    if (newSelection.has(key)) {
      newSelection.delete(key);
    } else {
      newSelection.add(key);
    }
    setSelectedModels(newSelection);
  };

  const handleAddSelectedModels = () => {
    const newTargets = [...editingAlias.targets];

    selectedModels.forEach((key) => {
      const separatorIndex = key.indexOf('|');
      const providerId = key.substring(0, separatorIndex);
      const modelId = key.substring(separatorIndex + 1);
      const provider = providers.find((p) => p.id === providerId);
      const model = availableModels.find((m) => m.id === modelId && m.providerId === providerId);

      if (provider && model) {
        const alreadyExists = editingAlias.targets.some(
          (t) => t.provider === providerId && t.model === modelId
        );
        if (!alreadyExists) {
          newTargets.push({
            provider: providerId,
            model: modelId,
            enabled: true,
          });
        }
      }
    });

    setEditingAlias({ ...editingAlias, targets: newTargets });
    setIsAutoAddModalOpen(false);
    setSubstring('');
    setFilteredModels([]);
    setSelectedModels(new Set());
  };

  const addAlias = () => {
    setEditingAlias({
      ...editingAlias,
      aliases: [...(editingAlias.aliases || []), ''],
    });
  };

  const updateAlias = (index: number, value: string) => {
    const newAliases = [...(editingAlias.aliases || [])];
    newAliases[index] = value;
    setEditingAlias({ ...editingAlias, aliases: newAliases });
  };

  const removeAlias = (index: number) => {
    const newAliases = [...(editingAlias.aliases || [])];
    newAliases.splice(index, 1);
    setEditingAlias({ ...editingAlias, aliases: newAliases });
  };

  /** Returns the current `enabled` state of a named behavior, defaulting to false. */
  const getBehavior = (type: AliasBehavior['type']): boolean => {
    return (editingAlias.advanced ?? []).some((b) => b.type === type && b.enabled !== false);
  };

  /** Toggles a behavior on/off, adding it to the list if not present. */
  const setBehavior = (type: AliasBehavior['type'], enabled: boolean) => {
    const current = editingAlias.advanced ?? [];
    const without = current.filter((b) => b.type !== type);
    const next: AliasBehavior[] = enabled
      ? [...without, { type, enabled: true } as AliasBehavior]
      : without; // remove entirely when disabled to keep YAML clean
    setEditingAlias({ ...editingAlias, advanced: next });
  };

  /**
   * Cancel any pending debounced metadata search so a stale response cannot
   * later overwrite `metadataResults` after the source/query has moved on.
   * Callers that change `metadata.source` or clear the query must invoke this
   * before mutating state.
   */
  const cancelMetadataDebounce = () => {
    if (metadataSearchRef.current) {
      clearTimeout(metadataSearchRef.current);
      metadataSearchRef.current = null;
    }
  };

  /** Search metadata catalog for autocomplete */
  const handleMetadataSearch = useCallback((query: string, source: MetadataSource) => {
    if (source === 'custom') {
      // Custom has no catalog to search against — also kill any pending debounce
      // from the prior catalog source so it can't land stale results.
      cancelMetadataDebounce();
      setMetadataQuery(query);
      setMetadataResults([]);
      setShowMetadataDropdown(false);
      setIsMetadataSearching(false);
      return;
    }
    setMetadataQuery(query);
    cancelMetadataDebounce();
    if (!query.trim()) {
      setMetadataResults([]);
      setShowMetadataDropdown(false);
      setIsMetadataSearching(false);
      return;
    }
    setIsMetadataSearching(true);
    setShowMetadataDropdown(true);
    metadataSearchRef.current = setTimeout(async () => {
      try {
        const resp = await api.searchModelMetadata(source, query, 30);
        setMetadataResults(resp.data);
      } catch {
        setMetadataResults([]);
      } finally {
        setIsMetadataSearching(false);
      }
    }, 250);
  }, []);

  /** Select a metadata result and set it on the alias (preserves existing overrides). */
  const selectMetadataResult = (result: { id: string; name: string }) => {
    const current = editingAlias.metadata;
    const source: Exclude<MetadataSource, 'custom'> =
      current?.source && current.source !== 'custom' ? current.source : 'openrouter';
    setEditingAlias({
      ...editingAlias,
      metadata: {
        source,
        source_path: result.id,
        ...(current?.overrides ? { overrides: current.overrides } : {}),
      },
    });
    setMetadataQuery(result.name);
    setShowMetadataDropdown(false);
    setMetadataResults([]);
    // If override is already on, refresh the form with the newly-selected
    // model's catalog values (still preserving any fields the user typed).
    if (isOverrideOpen) {
      populateOverridesFromCatalog(source, result.id);
    }
  };

  /** Clear metadata from the alias */
  const clearMetadata = () => {
    // Drop any in-flight debounced search so it can't repopulate results
    // against an alias that no longer has metadata attached.
    cancelMetadataDebounce();
    const { metadata: _removed, ...rest } = editingAlias;
    setEditingAlias(rest as Alias);
    setMetadataQuery('');
    setMetadataResults([]);
    setShowMetadataDropdown(false);
    setIsMetadataSearching(false);
    // Without this, re-adding a source would reopen the override form with
    // stale `isOverrideOpen` state from the cleared metadata.
    setIsOverrideOpen(false);
  };

  /** Seed defaults when a user first picks the 'custom' source. */
  const buildCustomDefaults = (aliasId: string): MetadataOverrides => ({
    name: aliasId || 'Custom Model',
    context_length: 4096,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: [],
  });

  /**
   * Convert a catalog metadata record into the `MetadataOverrides` shape,
   * keeping only defined fields so no spurious empty keys land in the config.
   */
  const metadataToOverrides = (meta: NormalizedModelMetadata): MetadataOverrides => {
    const out: MetadataOverrides = {};
    if (meta.name) out.name = meta.name;
    if (meta.description !== undefined) out.description = meta.description;
    if (meta.context_length !== undefined) out.context_length = meta.context_length;
    if (meta.pricing) {
      const p: NonNullable<MetadataOverrides['pricing']> = {};
      if (meta.pricing.prompt !== undefined) p.prompt = meta.pricing.prompt;
      if (meta.pricing.completion !== undefined) p.completion = meta.pricing.completion;
      if (meta.pricing.input_cache_read !== undefined)
        p.input_cache_read = meta.pricing.input_cache_read;
      if (meta.pricing.input_cache_write !== undefined)
        p.input_cache_write = meta.pricing.input_cache_write;
      if (Object.keys(p).length > 0) out.pricing = p;
    }
    if (meta.architecture) {
      const a: NonNullable<MetadataOverrides['architecture']> = {};
      if (meta.architecture.input_modalities && meta.architecture.input_modalities.length > 0)
        a.input_modalities = [...meta.architecture.input_modalities];
      if (meta.architecture.output_modalities && meta.architecture.output_modalities.length > 0)
        a.output_modalities = [...meta.architecture.output_modalities];
      if (meta.architecture.tokenizer !== undefined) a.tokenizer = meta.architecture.tokenizer;
      if (Object.keys(a).length > 0) out.architecture = a;
    }
    if (meta.supported_parameters && meta.supported_parameters.length > 0)
      out.supported_parameters = [...meta.supported_parameters];
    if (meta.top_provider) {
      const tp: NonNullable<MetadataOverrides['top_provider']> = {};
      if (meta.top_provider.context_length !== undefined)
        tp.context_length = meta.top_provider.context_length;
      if (meta.top_provider.max_completion_tokens !== undefined)
        tp.max_completion_tokens = meta.top_provider.max_completion_tokens;
      if (Object.keys(tp).length > 0) out.top_provider = tp;
    }
    return out;
  };

  /**
   * Return `current` with its overrides replaced by `overrides`, preserving
   * the 'custom' variant's `name: string` invariant for the type system.
   * Callers that delete `name` for a custom source are relying on the
   * runtime code path that substitutes an empty string; this helper keeps
   * that guarantee visible to TypeScript.
   */
  const withOverrides = (
    current: AliasMetadata,
    overrides: MetadataOverrides
  ): AliasMetadata => {
    if (current.source === 'custom') {
      return {
        ...current,
        overrides: {
          ...overrides,
          name: overrides.name ?? current.overrides.name,
        },
      };
    }
    return { ...current, overrides };
  };

  /**
   * Return the subset of `existing` that differs from `reference`. Used to
   * strip auto-populated-from-catalog values out of an overrides blob so that
   * only genuine user-edits remain. Top-level fields are compared by identity
   * (or element-wise for arrays); nested objects (pricing/architecture/
   * top_provider) are compared field-by-field one level deep.
   */
  const diffOverrides = (
    existing: MetadataOverrides,
    reference: MetadataOverrides
  ): MetadataOverrides => {
    const valuesEqual = (a: unknown, b: unknown): boolean => {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
      }
      return false;
    };
    const out: MetadataOverrides = {};
    for (const key of Object.keys(existing) as (keyof MetadataOverrides)[]) {
      const ev = existing[key];
      const rv = reference[key];
      if (ev === undefined) continue;
      if (
        ev !== null &&
        typeof ev === 'object' &&
        !Array.isArray(ev) &&
        rv !== null &&
        typeof rv === 'object' &&
        !Array.isArray(rv)
      ) {
        // Nested object (pricing/architecture/top_provider): recurse one level.
        const nested: Record<string, unknown> = {};
        for (const sub of Object.keys(ev as object)) {
          const sev = (ev as Record<string, unknown>)[sub];
          const srv = (rv as Record<string, unknown>)[sub];
          if (sev !== undefined && !valuesEqual(sev, srv)) nested[sub] = sev;
        }
        if (Object.keys(nested).length > 0) {
          (out as Record<string, unknown>)[key] = nested;
        }
      } else if (!valuesEqual(ev, rv)) {
        (out as Record<string, unknown>)[key] = ev;
      }
    }
    return out;
  };

  /**
   * Fetch catalog metadata for (source, sourcePath) and populate the override
   * form with those values, preserving any overrides the user has already
   * typed (user-entered values win on conflict).
   *
   * Silently no-ops when source is custom, source_path is unset, or the lookup
   * fails — in those cases the form simply stays empty.
   *
   * Caller must pass explicit (source, sourcePath) rather than reading
   * `editingAlias` here, because we're often invoked right after a state
   * update that hasn't flushed — e.g. when the user selects a new catalog
   * model while override is already on.
   */
  const populateOverridesFromCatalog = async (
    source: Exclude<MetadataSource, 'custom'>,
    sourcePath: string
  ) => {
    if (!sourcePath) return;
    // Capture the current catalog snapshot BEFORE the async fetch. When the
    // caller (e.g. selectMetadataResult) has just switched catalog models,
    // this is still the prior catalog — exactly what we need to distinguish
    // true user edits from values that were auto-populated last time.
    const priorCatalog = catalogReference ?? null;
    try {
      const catalog = await api.getModelMetadata(source, sourcePath);
      if (!catalog) return;
      const catalogOverrides = metadataToOverrides(catalog);
      setEditingAlias((prev) => {
        // Bail if the alias's metadata pointer changed while we were fetching
        // (e.g. user toggled off, or picked a different model).
        if (!prev.metadata || prev.metadata.source === 'custom') return prev;
        if (prev.metadata.source !== source || prev.metadata.source_path !== sourcePath)
          return prev;
        // `existing` may hold values that were auto-populated from the prior
        // catalog rather than typed by the user. Strip anything matching the
        // prior snapshot so only real user-edits layer over the new catalog.
        // When we have no prior snapshot (first populate), treat `existing`
        // as all user-edits.
        const existing = prev.metadata.overrides ?? {};
        const userEdits = priorCatalog ? diffOverrides(existing, priorCatalog) : existing;
        const merged: MetadataOverrides = {
          ...catalogOverrides,
          ...userEdits,
          ...(catalogOverrides.pricing || userEdits.pricing
            ? { pricing: { ...(catalogOverrides.pricing ?? {}), ...(userEdits.pricing ?? {}) } }
            : {}),
          ...(catalogOverrides.architecture || userEdits.architecture
            ? {
                architecture: {
                  ...(catalogOverrides.architecture ?? {}),
                  ...(userEdits.architecture ?? {}),
                },
              }
            : {}),
          ...(catalogOverrides.top_provider || userEdits.top_provider
            ? {
                top_provider: {
                  ...(catalogOverrides.top_provider ?? {}),
                  ...(userEdits.top_provider ?? {}),
                },
              }
            : {}),
        };
        return { ...prev, metadata: { ...prev.metadata, overrides: merged } };
      });
    } catch {
      // Leave the form blank on error; existing helper text tells the user
      // blank fields fall back to the catalog value.
    }
  };

  // Keep `catalogReference` in sync with the currently selected catalog
  // (source, source_path). Used by `countOverrides` to decide which fields
  // actually differ from the auto-populated values.
  useEffect(() => {
    const meta = editingAlias.metadata;
    if (!meta || meta.source === 'custom' || !meta.source_path) {
      setCatalogReference(undefined);
      return;
    }
    const { source, source_path } = meta;
    let cancelled = false;
    (async () => {
      try {
        const catalog = await api.getModelMetadata(source, source_path);
        if (cancelled) return;
        setCatalogReference(catalog ? metadataToOverrides(catalog) : null);
      } catch {
        if (!cancelled) setCatalogReference(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // metadataToOverrides is a stable local helper that doesn't close over state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAlias.metadata?.source, editingAlias.metadata?.source_path]);

  /**
   * Patch a single field in the override blob. `undefined` removes the key
   * so the field falls back to the catalog value — except for the `name`
   * field in custom mode, which has no catalog fallback and is required by
   * the backend schema. In that case we store an empty string instead of
   * deleting, letting the save-time validator surface the error clearly.
   */
  const setOverrideField = <K extends keyof MetadataOverrides>(
    key: K,
    value: MetadataOverrides[K] | undefined
  ) => {
    const current = editingAlias.metadata;
    if (!current) return;
    const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
    if (value === undefined) {
      if (current.source === 'custom' && key === 'name') {
        nextOverrides.name = '';
      } else {
        delete nextOverrides[key];
      }
    } else {
      nextOverrides[key] = value;
    }
    setEditingAlias({
      ...editingAlias,
      metadata: withOverrides(current, nextOverrides),
    });
  };

  const setPricingField = (
    key: keyof NonNullable<MetadataOverrides['pricing']>,
    value: string | undefined
  ) => {
    const current = editingAlias.metadata;
    if (!current) return;
    const pricing = { ...(current.overrides?.pricing ?? {}) };
    if (value === undefined || value === '') delete pricing[key];
    else pricing[key] = value;
    const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
    if (Object.keys(pricing).length === 0) delete nextOverrides.pricing;
    else nextOverrides.pricing = pricing;
    setEditingAlias({ ...editingAlias, metadata: withOverrides(current, nextOverrides) });
  };

  const setArchitectureField = (
    key: keyof NonNullable<MetadataOverrides['architecture']>,
    value: string | string[] | undefined
  ) => {
    const current = editingAlias.metadata;
    if (!current) return;
    const arch = { ...(current.overrides?.architecture ?? {}) };
    if (value === undefined || (Array.isArray(value) && value.length === 0) || value === '')
      delete arch[key];
    else (arch as any)[key] = value;
    const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
    if (Object.keys(arch).length === 0) delete nextOverrides.architecture;
    else nextOverrides.architecture = arch;
    setEditingAlias({ ...editingAlias, metadata: withOverrides(current, nextOverrides) });
  };

  const setTopProviderField = (
    key: keyof NonNullable<MetadataOverrides['top_provider']>,
    value: number | undefined
  ) => {
    const current = editingAlias.metadata;
    if (!current) return;
    const tp = { ...(current.overrides?.top_provider ?? {}) };
    if (value === undefined) delete tp[key];
    else tp[key] = value;
    const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
    if (Object.keys(tp).length === 0) delete nextOverrides.top_provider;
    else nextOverrides.top_provider = tp;
    setEditingAlias({ ...editingAlias, metadata: withOverrides(current, nextOverrides) });
  };

  /**
   * Count the number of overridden fields for the preview strip. Only fields
   * whose values *differ* from the reference are counted:
   *   - custom source: compared against `buildCustomDefaults(aliasId)`
   *   - catalog source: compared against the auto-populated catalog values
   * While the catalog lookup is still in flight for a catalog-backed source
   * we report 0 so the strip doesn't flash a spurious "all fields overridden"
   * count on open.
   */
  const countOverrides = (metadata?: AliasMetadata): number => {
    if (!metadata?.overrides) return 0;
    const o = metadata.overrides;
    let ref: MetadataOverrides;
    if (metadata.source === 'custom') {
      ref = buildCustomDefaults(editingAlias.id);
    } else if (catalogReference === undefined) {
      // Catalog still loading — avoid flashing a spurious count.
      return 0;
    } else {
      ref = catalogReference ?? {};
    }
    const arrayEq = (a?: string[], b?: string[]): boolean => {
      if (a === b) return true;
      if (!a || !b) return false;
      if (a.length !== b.length) return false;
      return a.every((v, i) => v === b[i]);
    };
    let n = 0;
    if (o.name !== undefined && o.name !== ref.name) n++;
    if (o.description !== undefined && o.description !== ref.description) n++;
    if (o.context_length !== undefined && o.context_length !== ref.context_length) n++;
    if (o.pricing) {
      const r = ref.pricing ?? {};
      if (o.pricing.prompt !== undefined && o.pricing.prompt !== r.prompt) n++;
      if (o.pricing.completion !== undefined && o.pricing.completion !== r.completion) n++;
      if (o.pricing.input_cache_read !== undefined && o.pricing.input_cache_read !== r.input_cache_read)
        n++;
      if (
        o.pricing.input_cache_write !== undefined &&
        o.pricing.input_cache_write !== r.input_cache_write
      )
        n++;
    }
    if (o.architecture) {
      const r = ref.architecture ?? {};
      if (
        o.architecture.input_modalities !== undefined &&
        !arrayEq(o.architecture.input_modalities, r.input_modalities)
      )
        n++;
      if (
        o.architecture.output_modalities !== undefined &&
        !arrayEq(o.architecture.output_modalities, r.output_modalities)
      )
        n++;
      if (o.architecture.tokenizer !== undefined && o.architecture.tokenizer !== r.tokenizer) n++;
    }
    if (o.supported_parameters !== undefined && !arrayEq(o.supported_parameters, ref.supported_parameters))
      n++;
    if (o.top_provider) {
      const r = ref.top_provider ?? {};
      if (o.top_provider.context_length !== undefined && o.top_provider.context_length !== r.context_length)
        n++;
      if (
        o.top_provider.max_completion_tokens !== undefined &&
        o.top_provider.max_completion_tokens !== r.max_completion_tokens
      )
        n++;
    }
    return n;
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    setDragSourceIndex(index);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDragSourceIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);

    setDragSourceIndex(null);
    setDragOverIndex(null);

    if (dragIndex === dropIndex) return;

    const newTargets = [...editingAlias.targets];
    const [draggedItem] = newTargets.splice(dragIndex, 1);
    newTargets.splice(dropIndex, 0, draggedItem);

    setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const sortedAliases = [...aliases].sort((a, b) => a.id.localeCompare(b.id));

  const filteredAliases = sortedAliases.filter((a) =>
    a.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-linear-to-br from-bg-deep to-bg-surface">
      <div className="mb-6">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h1 className="font-heading text-3xl font-bold text-text m-0">Models</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-bg-glass border border-border-glass">
                <Eye size={14} className="text-text-secondary" />
                <span className="text-xs font-medium text-text-secondary">
                  Vision Fall Through Model:
                </span>
                <select
                  className="bg-transparent border-none text-xs text-text outline-none focus:ring-0 cursor-pointer"
                  value={globalDescriptorModel}
                  onChange={(e) => setGlobalDescriptorModel(e.target.value)}
                >
                  <option value="">(None)</option>
                  {sortedAliases.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveDescriptor}
                  disabled={isSavingDescriptor}
                  className="ml-1 text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
                  title="Save descriptor model"
                >
                  {isSavingDescriptor ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', width: '280px' }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-secondary)',
                }}
              />
              <Input
                placeholder="Search models..."
                style={{ paddingLeft: '36px' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant="danger"
              leftIcon={<Trash2 size={16} />}
              onClick={() => setIsDeleteAllModalOpen(true)}
              disabled={aliases.length === 0}
            >
              Delete All Models
            </Button>
            <Button leftIcon={<Plus size={16} />} onClick={handleAddNew}>
              Add Model
            </Button>
          </div>
        </div>
      </div>

      <Card className="mb-6">
        <div className="overflow-x-auto -m-6">
          <table className="w-full border-collapse font-body text-[13px]">
            <thead>
              <tr>
                <th
                  className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                  style={{ paddingLeft: '24px' }}
                >
                  Alias
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Aliases
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Selector
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Metadata
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
              {filteredAliases.map((alias) => (
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
                />
              ))}
              {filteredAliases.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-text-muted p-12">
                    No aliases found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
          <div className="grid grid-cols-4 gap-4">
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
                value={editingAlias.type || 'chat'}
                onChange={(e) =>
                  setEditingAlias({
                    ...editingAlias,
                    type: e.target.value as
                      | 'chat'
                      | 'embeddings'
                      | 'transcriptions'
                      | 'speech'
                      | 'image'
                      | 'responses',
                  })
                }
              >
                <option value="chat">Chat</option>
                <option value="embeddings">Embeddings</option>
                <option value="transcriptions">Transcriptions</option>
                <option value="speech">Speech</option>
                <option value="image">Image</option>
                <option value="responses">Responses</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                Selector Strategy
              </label>
              <select
                className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                value={editingAlias.selector || 'random'}
                onChange={(e) => setEditingAlias({ ...editingAlias, selector: e.target.value })}
              >
                <option value="random">Random</option>
                <option value="in_order">In Order</option>
                <option value="cost">Lowest Cost</option>
                <option value="latency">Lowest Latency</option>
                <option value="usage">Usage Balanced</option>
                <option value="performance">Best Performance</option>
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
            Priority: "Selector" uses the strategy above. "API Match" matches provider type to
            incoming request format.
          </p>

          <div className="h-px bg-border-glass" style={{ margin: '4px 0' }}></div>

          {/* Advanced accordion */}
          <div className="border border-border-glass rounded-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
            >
              <span className="font-body text-[13px] font-medium text-text-secondary">
                Advanced
              </span>
              {isAdvancedOpen ? (
                <ChevronDown size={14} className="text-text-muted" />
              ) : (
                <ChevronRight size={14} className="text-text-muted" />
              )}
            </button>

            {isAdvancedOpen && (
              <div
                className="px-3 py-3 border-t border-border-glass"
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                {/* ── Behaviors ── */}
                <div>
                  <label
                    className="font-body text-[13px] font-medium text-text-secondary"
                    style={{ display: 'block', marginBottom: '6px' }}
                  >
                    Behaviors
                  </label>
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="font-body text-[13px] text-text">
                        Strip Adaptive Thinking
                      </span>
                      <p className="font-body text-[11px] text-text-muted mt-0.5">
                        On the <code className="text-primary">/v1/messages</code> path, remove{' '}
                        <code className="text-primary">thinking</code> when set to{' '}
                        <code className="text-primary">adaptive</code> so the provider uses its
                        default behaviour.
                      </p>
                    </div>
                    <Switch
                      checked={getBehavior('strip_adaptive_thinking')}
                      onChange={(val) => setBehavior('strip_adaptive_thinking', val)}
                      size="sm"
                    />
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="font-body text-[13px] text-text">Vision Fallthrough</span>
                      <p className="font-body text-[11px] text-text-muted mt-0.5">
                        If the request contains images and the target model is text-only, use the
                        descriptor model to convert images to text.
                      </p>
                    </div>
                    <Switch
                      checked={editingAlias.use_image_fallthrough || false}
                      onChange={(val) =>
                        setEditingAlias({ ...editingAlias, use_image_fallthrough: val })
                      }
                      size="sm"
                    />
                  </div>
                </div>

                <div className="h-px bg-border-glass"></div>

                {/* ── Additional Aliases ── */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px',
                    }}
                  >
                    <label
                      className="font-body text-[13px] font-medium text-text-secondary"
                      style={{ marginBottom: 0 }}
                    >
                      Additional Aliases
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={addAlias}
                      leftIcon={<Plus size={14} />}
                    >
                      Add Alias
                    </Button>
                  </div>

                  {(!editingAlias.aliases || editingAlias.aliases.length === 0) && (
                    <div className="text-text-muted italic text-center text-sm py-2">
                      No additional aliases
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {editingAlias.aliases?.map((alias, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px' }}>
                        <Input
                          value={alias}
                          onChange={(e) => updateAlias(idx, e.target.value)}
                          placeholder="e.g. gpt4"
                          style={{ flex: 1 }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAlias(idx)}
                          style={{ color: 'var(--color-danger)' }}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-border-glass" style={{ margin: '4px 0' }}></div>

          {/* Metadata accordion */}
          <div className="border border-border-glass rounded-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setIsMetadataOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BookOpen size={13} className="text-text-muted" />
                <span className="font-body text-[13px] font-medium text-text-secondary">
                  Metadata
                </span>
                {editingAlias.metadata && (
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary bg-bg-hover">
                    {editingAlias.metadata.source}
                  </span>
                )}
              </div>
              {isMetadataOpen ? (
                <ChevronDown size={14} className="text-text-muted" />
              ) : (
                <ChevronRight size={14} className="text-text-muted" />
              )}
            </button>

            {isMetadataOpen && (
              <div
                className="px-3 py-3 border-t border-border-glass"
                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                <p className="font-body text-[11px] text-text-muted">
                  Link this alias to a model in an external catalog. When configured, Plexus
                  includes enriched metadata (name, context length, pricing, supported parameters)
                  in the <code className="text-primary">GET /v1/models</code> response.
                </p>

                {/* Source selector */}
                <div>
                  <label
                    className="font-body text-[12px] font-medium text-text-secondary"
                    style={{ display: 'block', marginBottom: '4px' }}
                  >
                    Source
                  </label>
                  <select
                    className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                    style={{ padding: '5px 8px', height: '30px' }}
                    value={editingAlias.metadata?.source ?? 'openrouter'}
                    onChange={(e) => {
                      const source = e.target.value as MetadataSource;
                      const prevSource = editingAlias.metadata?.source;
                      const existingOverrides = editingAlias.metadata?.overrides;
                      const existingSourcePath = editingAlias.metadata?.source_path;
                      // Different catalogs use different path formats (e.g.
                      // openrouter's "openai/gpt-4.1-nano" ≠ models.dev's
                      // "openai.gpt-4.1-nano"), so a path from the old catalog
                      // is always wrong under a new one. Only carry the path
                      // when the source is unchanged or switching to 'custom'
                      // (where source_path is a free-form label).
                      const carryPath = prevSource === source || source === 'custom';
                      const carriedSourcePath = carryPath ? existingSourcePath : undefined;
                      let next: AliasMetadata;
                      if (source === 'custom') {
                        // Seed defaults, then layer any existing overrides on top so
                        // user-typed values take precedence while missing required
                        // fields (e.g., name) still have a sensible default. Nested
                        // objects (architecture/pricing/top_provider) are merged
                        // field-by-field so a partial user override (e.g. only
                        // input_modalities) doesn't wipe default sibling fields
                        // (e.g. output_modalities).
                        const defaults = buildCustomDefaults(editingAlias.id);
                        const existing = existingOverrides ?? {};
                        const mergedOverrides = {
                          ...defaults,
                          ...existing,
                          ...(defaults.pricing || existing.pricing
                            ? {
                                pricing: {
                                  ...(defaults.pricing ?? {}),
                                  ...(existing.pricing ?? {}),
                                },
                              }
                            : {}),
                          ...(defaults.architecture || existing.architecture
                            ? {
                                architecture: {
                                  ...(defaults.architecture ?? {}),
                                  ...(existing.architecture ?? {}),
                                },
                              }
                            : {}),
                          ...(defaults.top_provider || existing.top_provider
                            ? {
                                top_provider: {
                                  ...(defaults.top_provider ?? {}),
                                  ...(existing.top_provider ?? {}),
                                },
                              }
                            : {}),
                        } as MetadataOverrides & { name: string };
                        next = {
                          source: 'custom',
                          ...(carriedSourcePath ? { source_path: carriedSourcePath } : {}),
                          overrides: mergedOverrides,
                        };
                        setIsOverrideOpen(true);
                      } else {
                        next = {
                          source,
                          source_path: carriedSourcePath ?? '',
                          ...(existingOverrides ? { overrides: existingOverrides } : {}),
                        };
                      }
                      setEditingAlias({ ...editingAlias, metadata: next });
                      // Changing catalogs (or switching to custom) can leave
                      // a pending debounced search from the prior source that
                      // would overwrite `metadataResults` with stale data; kill
                      // it before any conditional re-run below.
                      if (prevSource !== source) {
                        cancelMetadataDebounce();
                        setMetadataResults([]);
                        setShowMetadataDropdown(false);
                        setIsMetadataSearching(false);
                      }
                      // When we dropped the path, also clear the visible model
                      // query input so it doesn't show a stale value that no
                      // longer matches metadata.source_path.
                      if (!carryPath) setMetadataQuery('');
                      // Re-run search only when we kept the query (same catalog).
                      if (carryPath && source !== 'custom' && metadataQuery)
                        handleMetadataSearch(metadataQuery, source);
                    }}
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="models.dev">models.dev</option>
                    <option value="catwalk">Catwalk (Charm)</option>
                    <option value="custom">Custom (manual entry)</option>
                  </select>
                </div>

                {/* Search / source_path — hidden for 'custom' (no catalog) */}
                {editingAlias.metadata?.source !== 'custom' && (
                  <div style={{ position: 'relative' }}>
                    <label
                      className="font-body text-[12px] font-medium text-text-secondary"
                      style={{ display: 'block', marginBottom: '4px' }}
                    >
                      Model
                      {editingAlias.metadata?.source_path && (
                        <span className="ml-2 font-normal text-text-muted">
                          ({editingAlias.metadata.source_path})
                        </span>
                      )}
                    </label>
                    <div style={{ position: 'relative', display: 'flex', gap: '4px' }}>
                      <div ref={metadataInputWrapperRef} style={{ position: 'relative', flex: 1 }}>
                        <Input
                          value={metadataQuery}
                          onChange={(e) => {
                            const source = editingAlias.metadata?.source ?? 'openrouter';
                            handleMetadataSearch(e.target.value, source);
                            // Update rect so portal dropdown follows the input
                            if (metadataInputWrapperRef.current) {
                              const r = metadataInputWrapperRef.current.getBoundingClientRect();
                              setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                            }
                          }}
                          onFocus={() => {
                            if (metadataResults.length > 0) {
                              if (metadataInputWrapperRef.current) {
                                const r = metadataInputWrapperRef.current.getBoundingClientRect();
                                setDropdownRect({
                                  top: r.bottom + 2,
                                  left: r.left,
                                  width: r.width,
                                });
                              }
                              setShowMetadataDropdown(true);
                            }
                          }}
                          placeholder={`Search ${editingAlias.metadata?.source ?? 'openrouter'} catalog...`}
                          style={{
                            width: '100%',
                            paddingRight: isMetadataSearching ? '28px' : undefined,
                          }}
                          onBlur={() => setShowMetadataDropdown(false)}
                        />
                        {isMetadataSearching && (
                          <Loader2
                            size={14}
                            className="animate-spin text-text-muted"
                            style={{
                              position: 'absolute',
                              right: '8px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                            }}
                          />
                        )}
                      </div>
                      {editingAlias.metadata && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearMetadata}
                          style={{
                            color: 'var(--color-danger)',
                            padding: '4px',
                            minHeight: 'auto',
                          }}
                          title="Remove metadata"
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Selected metadata preview */}
                {editingAlias.metadata &&
                  (editingAlias.metadata.source === 'custom' ||
                    editingAlias.metadata.source_path ||
                    editingAlias.metadata.overrides) && (
                    <div
                      className="rounded-sm border border-border-glass bg-bg-subtle px-3 py-2"
                      style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle size={12} className="text-success" />
                        <span>
                          {editingAlias.metadata.source === 'custom' ? (
                            <>
                              Custom metadata
                              {editingAlias.metadata.source_path && (
                                <>
                                  :{' '}
                                  <code className="text-primary">
                                    {editingAlias.metadata.source_path}
                                  </code>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              Metadata assigned from <strong>{editingAlias.metadata.source}</strong>
                              {editingAlias.metadata.source_path && (
                                <>
                                  :{' '}
                                  <code className="text-primary">
                                    {editingAlias.metadata.source_path}
                                  </code>
                                </>
                              )}
                            </>
                          )}
                          {countOverrides(editingAlias.metadata) > 0 && (
                            <span className="ml-2 text-text-muted">
                              + {countOverrides(editingAlias.metadata)} field
                              {countOverrides(editingAlias.metadata) === 1 ? '' : 's'} overridden
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                {/* Override toggle + editable form */}
                {editingAlias.metadata && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editingAlias.metadata.source !== 'custom' && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <label
                          className="font-body text-[12px] font-medium text-text-secondary"
                          style={{ marginBottom: 0 }}
                        >
                          Override catalog fields
                        </label>
                        <Switch
                          checked={isOverrideOpen}
                          onChange={(v) => {
                            setIsOverrideOpen(v);
                            if (!v) {
                              // Flipping override off clears any existing overrides.
                              const current = editingAlias.metadata;
                              if (current) {
                                const { overrides: _o, ...rest } = current;
                                setEditingAlias({
                                  ...editingAlias,
                                  metadata: rest as AliasMetadata,
                                });
                              }
                            } else {
                              // Flipping override on auto-populates the form with
                              // the catalog's current values so the user sees what
                              // they're overriding instead of a blank form.
                              const cur = editingAlias.metadata;
                              if (cur && cur.source !== 'custom' && cur.source_path) {
                                populateOverridesFromCatalog(cur.source, cur.source_path);
                              }
                            }
                          }}
                        />
                      </div>
                    )}

                    {(isOverrideOpen || editingAlias.metadata.source === 'custom') && (
                      <MetadataOverrideForm
                        overrides={editingAlias.metadata.overrides ?? {}}
                        isCustom={editingAlias.metadata.source === 'custom'}
                        onSetField={setOverrideField}
                        onSetPricing={setPricingField}
                        onSetArchitecture={setArchitectureField}
                        onSetTopProvider={setTopProviderField}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-border-glass" style={{ margin: '4px 0' }}></div>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <label
                className="font-body text-[13px] font-medium text-text-secondary"
                style={{ marginBottom: 0 }}
              >
                Targets
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleOpenAutoAdd}
                  leftIcon={<Zap size={14} />}
                >
                  Auto Add
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addTarget}
                  leftIcon={<Plus size={14} />}
                >
                  Add Target
                </Button>
              </div>
            </div>

            {editingAlias.targets.length === 0 && (
              <div className="text-text-muted italic text-center text-sm py-2">
                No targets configured (Model will not work)
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {editingAlias.targets.map((target, idx) => {
                const isDragging = dragSourceIndex === idx;
                const isDragOver = dragOverIndex === idx && !isDragging;

                return (
                  <div
                    key={idx}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, idx)}
                    style={{
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'center',
                      padding: '4px 8px',
                      backgroundColor: isDragging
                        ? 'transparent'
                        : isDragOver
                          ? 'rgba(245, 158, 11, 0.05)'
                          : 'var(--color-bg-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      border: isDragging
                        ? '1px dashed var(--color-border-glass)'
                        : isDragOver
                          ? '2px solid var(--color-primary)'
                          : '1px solid var(--color-border-glass)',
                      cursor: 'grab',
                      opacity: isDragging ? 0.4 : 1,
                      transform: isDragOver ? 'translateY(2px)' : 'none',
                      transition: 'all 0.2s ease',
                      position: 'relative',
                    }}
                    onDragStartCapture={(e) => {
                      (e.currentTarget as HTMLDivElement).style.cursor = 'grabbing';
                    }}
                    onDragEndCapture={(e) => {
                      (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
                    }}
                  >
                    {isDragOver && (
                      <div
                        style={{
                          position: 'absolute',
                          top: dragSourceIndex !== null && dragSourceIndex < idx ? 'auto' : -2,
                          bottom: dragSourceIndex !== null && dragSourceIndex > idx ? 'auto' : -2,
                          left: 0,
                          right: 0,
                          height: '2px',
                          backgroundColor: 'var(--color-primary)',
                          zIndex: 20,
                        }}
                      />
                    )}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: 'var(--color-text-secondary)',
                        opacity: 0.8,
                        marginRight: '4px',
                        visibility: isDragging ? 'hidden' : 'visible',
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveTarget(idx, 'up');
                        }}
                        disabled={idx === 0}
                        className="hover:scale-110 hover:text-primary disabled:opacity-30 disabled:hover:scale-100 transition-all duration-200"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '4px',
                          cursor: idx === 0 ? 'default' : 'pointer',
                        }}
                        title="Move Up"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveTarget(idx, 'down');
                        }}
                        disabled={idx === editingAlias.targets.length - 1}
                        className="hover:scale-110 hover:text-primary disabled:opacity-30 disabled:hover:scale-100 transition-all duration-200"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '4px',
                          cursor: idx === editingAlias.targets.length - 1 ? 'default' : 'pointer',
                        }}
                        title="Move Down"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    <div
                      style={{
                        cursor: 'grab',
                        color: 'var(--color-text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        visibility: isDragging ? 'hidden' : 'visible',
                      }}
                    >
                      <GripVertical size={16} />
                    </div>
                    <div
                      style={{
                        flex: '0 0 120px',
                        maxWidth: '120px',
                        visibility: isDragging ? 'hidden' : 'visible',
                      }}
                    >
                      <select
                        className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                        style={{ padding: '4px 8px', height: '28px' }}
                        value={target.provider}
                        onChange={(e) => updateTarget(idx, 'provider', e.target.value)}
                      >
                        <option value="">Select Provider...</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1, visibility: isDragging ? 'hidden' : 'visible' }}>
                      <select
                        className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                        style={{ padding: '4px 8px', height: '28px' }}
                        value={target.model}
                        onChange={(e) => updateTarget(idx, 'model', e.target.value)}
                        disabled={!target.provider}
                      >
                        <option value="">Select Model...</option>
                        {availableModels
                          .filter((m) => m.providerId === target.provider)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div style={{ visibility: isDragging ? 'hidden' : 'visible' }}>
                      <Switch
                        checked={target.enabled !== false}
                        onChange={(val) => updateTarget(idx, 'enabled', val)}
                        size="sm"
                      />
                    </div>
                    <div style={{ visibility: isDragging ? 'hidden' : 'visible' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTarget(idx)}
                        style={{ color: 'var(--color-danger)', padding: '4px', minHeight: 'auto' }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isAutoAddModalOpen}
        onClose={() => setIsAutoAddModalOpen(false)}
        title="Auto Add Targets"
        size="lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button variant="ghost" onClick={() => setIsAutoAddModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSelectedModels} disabled={selectedModels.size === 0}>
              Add {selectedModels.size} Target{selectedModels.size !== 1 ? 's' : ''}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Input
              placeholder="Search models (e.g. 'gpt-4', 'claude')"
              value={substring}
              onChange={(e) => setSubstring(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearchModels()}
              style={{ flex: 1 }}
            />
            <Button onClick={handleSearchModels}>Search</Button>
          </div>

          {filteredModels.length > 0 ? (
            <div
              style={{
                maxHeight: '400px',
                overflowY: 'auto',
                border: '1px solid var(--color-border-glass)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <table className="w-full border-collapse font-body text-[13px]">
                <thead
                  style={{
                    position: 'sticky',
                    top: 0,
                    backgroundColor: 'var(--color-bg-hover)',
                    zIndex: 10,
                  }}
                >
                  <tr>
                    <th
                      className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                      style={{ width: '40px' }}
                    >
                      <input
                        type="checkbox"
                        checked={
                          filteredModels.length > 0 &&
                          filteredModels.every(
                            (m) =>
                              selectedModels.has(`${m.provider.id}|${m.model.id}`) ||
                              editingAlias.targets.some(
                                (t) => t.provider === m.provider.id && t.model === m.model.id
                              )
                          )
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const newSelection = new Set(selectedModels);
                            filteredModels.forEach((m) => {
                              const key = `${m.provider.id}|${m.model.id}`;
                              if (
                                !editingAlias.targets.some(
                                  (t) => t.provider === m.provider.id && t.model === m.model.id
                                )
                              ) {
                                newSelection.add(key);
                              }
                            });
                            setSelectedModels(newSelection);
                          } else {
                            const newSelection = new Set(selectedModels);
                            filteredModels.forEach((m) => {
                              newSelection.delete(`${m.provider.id}|${m.model.id}`);
                            });
                            setSelectedModels(newSelection);
                          }
                        }}
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      Model
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModels.map(({ model, provider }) => {
                    const key = `${provider.id}|${model.id}`;
                    const alreadyExists = editingAlias.targets.some(
                      (t) => t.provider === provider.id && t.model === model.id
                    );
                    const isSelected = selectedModels.has(key);
                    const isDisabled = alreadyExists;

                    return (
                      <tr
                        key={key}
                        className="hover:bg-bg-hover"
                        style={{ opacity: isDisabled ? 0.5 : 1 }}
                      >
                        <td className="px-4 py-3 text-left text-text">
                          <input
                            type="checkbox"
                            checked={isSelected || alreadyExists}
                            disabled={isDisabled}
                            onChange={() => handleToggleModelSelection(model.id, provider.id)}
                          />
                        </td>
                        <td className="px-4 py-3 text-left text-text">{provider.name}</td>
                        <td className="px-4 py-3 text-left text-text">
                          {model.name}
                          {alreadyExists && (
                            <span
                              style={{
                                marginLeft: '8px',
                                fontSize: '11px',
                                color: 'var(--color-text-secondary)',
                                fontStyle: 'italic',
                              }}
                            >
                              (already added)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : substring ? (
            <div className="text-text-muted italic text-center text-sm py-8">
              No models found matching "{substring}"
            </div>
          ) : (
            <div className="text-text-muted italic text-center text-sm py-8">
              Enter a search term to find models
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isDeleteAllModalOpen}
        onClose={() => setIsDeleteAllModalOpen(false)}
        title="Delete All Models"
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button
              variant="ghost"
              onClick={() => setIsDeleteAllModalOpen(false)}
              disabled={isDeletingAll}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmDeleteAll} isLoading={isDeletingAll} variant="danger">
              Delete All
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
              Are you sure you want to delete all configured models?
            </p>
            <p className="text-text-secondary" style={{ fontSize: '14px' }}>
              This will permanently remove <strong>{aliases.length}</strong> model alias
              {aliases.length !== 1 ? 'es' : ''} from the configuration.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Model Alias"
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button
              variant="ghost"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmDelete} isLoading={isDeleting} variant="danger">
              Delete
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
              Are you sure you want to delete this alias?
            </p>
            <p className="text-text-secondary" style={{ fontSize: '14px' }}>
              <strong>{aliasToDelete?.id}</strong> will be permanently removed from the
              configuration.
            </p>
          </div>
        </div>
      </Modal>
      {/* Metadata autocomplete portal — rendered outside accordion to avoid overflow:hidden clipping */}
      {showMetadataDropdown &&
        metadataResults.length > 0 &&
        dropdownRect &&
        createPortal(
          <div
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 9999,
              backgroundColor: '#1E293B',
              border: '1px solid var(--color-border-glass)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxHeight: '180px',
              overflowY: 'auto',
            }}
          >
            {metadataResults.map((result) => (
              <button
                key={result.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMetadataResult(result);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border-glass)',
                }}
                className="hover:bg-bg-hover transition-colors"
              >
                <div className="font-body text-[12px] font-medium text-text">{result.name}</div>
                <div className="font-body text-[10px] text-text-muted">{result.id}</div>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
