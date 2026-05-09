import { useState, useRef, useCallback, useEffect } from 'react';
import {
  api,
  Alias,
  AliasMetadata,
  MetadataOverrides,
  MetadataSource,
  NormalizedModelMetadata,
} from '../lib/api';

/**
 * Encapsulates all state and logic related to the metadata accordion in the
 * Models edit/add modal.  Callers pass the current editingAlias + its setter
 * (both are stable refs inside the hook so callbacks always see the latest
 * alias) plus the modal open flag so the hook can sync state on open.
 */
export function useMetadataEditor(
  editingAlias: Alias,
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>,
  isModalOpen: boolean
) {
  // Keep a ref to the latest alias so callbacks don't go stale.
  const aliasRef = useRef(editingAlias);
  aliasRef.current = editingAlias;

  // ── UI toggle state ────────────────────────────────────────────────
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);

  // ── Catalog search state ───────────────────────────────────────────
  const [metadataQuery, setMetadataQuery] = useState('');
  const [metadataResults, setMetadataResults] = useState<{ id: string; name: string }[]>([]);
  const [isMetadataSearching, setIsMetadataSearching] = useState(false);
  const [showMetadataDropdown, setShowMetadataDropdown] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const metadataSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataInputWrapperRef = useRef<HTMLDivElement | null>(null);

  // Catalog snapshot used by countOverrides so we can diff user edits
  // from auto-populated values (undefined = loading, null = no catalog).
  const [catalogReference, setCatalogReference] = useState<MetadataOverrides | null | undefined>(
    undefined
  );

  // ── Helpers (pure) ─────────────────────────────────────────────────

  const cancelMetadataDebounce = useCallback(() => {
    if (metadataSearchRef.current) {
      clearTimeout(metadataSearchRef.current);
      metadataSearchRef.current = null;
    }
  }, []);

  /** Seed defaults when the user picks the 'custom' source. */
  const buildCustomDefaults = useCallback((aliasId: string): MetadataOverrides => {
    return {
      name: aliasId || 'Custom Model',
      context_length: 4096,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: [],
    };
  }, []);

  /** Convert a catalog metadata record into the MetadataOverrides shape. */
  const metadataToOverrides = useCallback((meta: NormalizedModelMetadata): MetadataOverrides => {
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
  }, []);

  /** Return `current` with overrides replaced, preserving custom's name invariant. */
  const withOverrides = useCallback(
    (current: AliasMetadata, overrides: MetadataOverrides): AliasMetadata => {
      if (current.source === 'custom') {
        return {
          ...current,
          overrides: { ...overrides, name: overrides.name ?? current.overrides.name },
        };
      }
      return { ...current, overrides };
    },
    []
  );

  /** Return subset of `existing` that differs from `reference`. */
  const diffOverrides = useCallback(
    (existing: MetadataOverrides, reference: MetadataOverrides): MetadataOverrides => {
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
          const nested: Record<string, unknown> = {};
          for (const sub of Object.keys(ev as object)) {
            const sev = (ev as Record<string, unknown>)[sub];
            const srv = (rv as Record<string, unknown>)[sub];
            if (sev !== undefined && !valuesEqual(sev, srv)) nested[sub] = sev;
          }
          if (Object.keys(nested).length > 0) (out as Record<string, unknown>)[key] = nested;
        } else if (!valuesEqual(ev, rv)) {
          (out as Record<string, unknown>)[key] = ev;
        }
      }
      return out;
    },
    []
  );

  /**
   * Fetch catalog metadata and populate the override form, preserving any
   * user-typed overrides (user values win on conflict).
   */
  const populateOverridesFromCatalog = useCallback(
    async (source: Exclude<MetadataSource, 'custom'>, sourcePath: string) => {
      if (!sourcePath) return;
      const priorCatalog = catalogReference ?? null;
      try {
        const catalog = await api.getModelMetadata(source, sourcePath);
        if (!catalog) return;
        const catalogOverrides = metadataToOverrides(catalog);
        setEditingAlias((prev) => {
          if (!prev.metadata || prev.metadata.source === 'custom') return prev;
          if (prev.metadata.source !== source || prev.metadata.source_path !== sourcePath)
            return prev;
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
        // Leave form blank on error.
      }
    },
    [catalogReference, setEditingAlias, metadataToOverrides, diffOverrides]
  );

  // ── Catalog search ─────────────────────────────────────────────────

  const handleMetadataSearch = useCallback(
    (query: string, source: MetadataSource) => {
      if (source === 'custom') {
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
    },
    [cancelMetadataDebounce]
  );

  const selectMetadataResult = useCallback(
    (result: { id: string; name: string }) => {
      const current = aliasRef.current;
      const meta = current.metadata;
      const source: Exclude<MetadataSource, 'custom'> =
        meta?.source && meta.source !== 'custom' ? meta.source : 'openrouter';
      setEditingAlias({
        ...current,
        metadata: {
          source,
          source_path: result.id,
          ...(meta?.overrides ? { overrides: meta.overrides } : {}),
        },
      });
      setMetadataQuery(result.name);
      setShowMetadataDropdown(false);
      setMetadataResults([]);
      if (isOverrideOpen) {
        populateOverridesFromCatalog(source, result.id);
      }
    },
    [setEditingAlias, isOverrideOpen, populateOverridesFromCatalog]
  );

  const clearMetadata = useCallback(() => {
    cancelMetadataDebounce();
    const current = aliasRef.current;
    const { metadata: _removed, ...rest } = current;
    setEditingAlias(rest as Alias);
    setMetadataQuery('');
    setMetadataResults([]);
    setShowMetadataDropdown(false);
    setIsMetadataSearching(false);
    setIsOverrideOpen(false);
  }, [cancelMetadataDebounce, setEditingAlias]);

  // ── Override field setters ─────────────────────────────────────────

  const setOverrideField = useCallback(
    <K extends keyof MetadataOverrides>(key: K, value: MetadataOverrides[K] | undefined) => {
      const current = aliasRef.current.metadata;
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
      setEditingAlias({ ...aliasRef.current, metadata: withOverrides(current, nextOverrides) });
    },
    [setEditingAlias, withOverrides]
  );

  const setPricingField = useCallback(
    (key: keyof NonNullable<MetadataOverrides['pricing']>, value: string | undefined) => {
      const current = aliasRef.current.metadata;
      if (!current) return;
      const pricing = { ...(current.overrides?.pricing ?? {}) };
      if (value === undefined || value === '') delete pricing[key];
      else pricing[key] = value;
      const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
      if (Object.keys(pricing).length === 0) delete nextOverrides.pricing;
      else nextOverrides.pricing = pricing;
      setEditingAlias({ ...aliasRef.current, metadata: withOverrides(current, nextOverrides) });
    },
    [setEditingAlias, withOverrides]
  );

  const setArchitectureField = useCallback(
    (
      key: keyof NonNullable<MetadataOverrides['architecture']>,
      value: string | string[] | undefined
    ) => {
      const current = aliasRef.current.metadata;
      if (!current) return;
      const arch = { ...(current.overrides?.architecture ?? {}) };
      if (value === undefined || (Array.isArray(value) && value.length === 0) || value === '')
        delete arch[key];
      else (arch as any)[key] = value;
      const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
      if (Object.keys(arch).length === 0) delete nextOverrides.architecture;
      else nextOverrides.architecture = arch;
      setEditingAlias({ ...aliasRef.current, metadata: withOverrides(current, nextOverrides) });
    },
    [setEditingAlias, withOverrides]
  );

  const setTopProviderField = useCallback(
    (key: keyof NonNullable<MetadataOverrides['top_provider']>, value: number | undefined) => {
      const current = aliasRef.current.metadata;
      if (!current) return;
      const tp = { ...(current.overrides?.top_provider ?? {}) };
      if (value === undefined) delete tp[key];
      else tp[key] = value;
      const nextOverrides: MetadataOverrides = { ...(current.overrides ?? {}) };
      if (Object.keys(tp).length === 0) delete nextOverrides.top_provider;
      else nextOverrides.top_provider = tp;
      setEditingAlias({ ...aliasRef.current, metadata: withOverrides(current, nextOverrides) });
    },
    [setEditingAlias, withOverrides]
  );

  const countOverrides = useCallback(
    (metadata?: AliasMetadata): number => {
      if (!metadata?.overrides) return 0;
      const o = metadata.overrides;
      let ref: MetadataOverrides;
      if (metadata.source === 'custom') {
        ref = buildCustomDefaults(aliasRef.current.id);
      } else if (catalogReference === undefined) {
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
        if (
          o.pricing.input_cache_read !== undefined &&
          o.pricing.input_cache_read !== r.input_cache_read
        )
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
      if (
        o.supported_parameters !== undefined &&
        !arrayEq(o.supported_parameters, ref.supported_parameters)
      )
        n++;
      if (o.top_provider) {
        const r = ref.top_provider ?? {};
        if (
          o.top_provider.context_length !== undefined &&
          o.top_provider.context_length !== r.context_length
        )
          n++;
        if (
          o.top_provider.max_completion_tokens !== undefined &&
          o.top_provider.max_completion_tokens !== r.max_completion_tokens
        )
          n++;
      }
      return n;
    },
    [catalogReference, buildCustomDefaults]
  );

  // ── Effects ────────────────────────────────────────────────────────

  // Sync when modal opens.
  useEffect(() => {
    if (!isModalOpen) return;
    cancelMetadataDebounce();
    const meta = editingAlias.metadata;
    setIsOverrideOpen(!!meta && (meta.source === 'custom' || !!meta.overrides));
    setMetadataQuery(meta?.source_path ?? '');
    setShowMetadataDropdown(false);
    setMetadataResults([]);
    setIsMetadataSearching(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, editingAlias.id]);

  // Keep catalogReference in sync with the selected catalog (source, source_path).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAlias.metadata?.source, editingAlias.metadata?.source_path]);

  return {
    // State
    isOverrideOpen,
    setIsOverrideOpen,
    metadataQuery,
    metadataResults,
    isMetadataSearching,
    showMetadataDropdown,
    setShowMetadataDropdown,
    dropdownRect,
    setDropdownRect,
    metadataInputWrapperRef,
    // Actions
    handleMetadataSearch,
    selectMetadataResult,
    clearMetadata,
    setOverrideField,
    setPricingField,
    setArchitectureField,
    setTopProviderField,
    countOverrides,
    populateOverridesFromCatalog,
    buildCustomDefaults,
  };
}
