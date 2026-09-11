import { normalizeApiAccessList } from '../apiFormats';
import { dedupeAliasTargets, dedupeById, dedupeModels, dedupeStrings } from '../modelOptions';
import { API_BASE, fetchWithAuth, inferProviderTypes } from './core';
import type {
  Alias,
  AliasTargetGroup,
  CatalogMetadataSource,
  Model,
  ModelMetadataRefreshResult,
  ModelResolutionPreview,
  NormalizedModelMetadata,
} from '../../types/aliases';

export function aliasToConfigPayload(alias: Alias): Record<string, unknown> {
  const targetGroups = dedupeAliasTargets(alias.target_groups);

  return {
    priority: alias.priority || 'selector',
    additional_aliases: dedupeStrings(alias.aliases ?? []),
    use_image_fallthrough: alias.use_image_fallthrough || false,
    enforce_limits: alias.enforce_limits || false,
    sticky_session: alias.sticky_session ?? true,
    ...(alias.preferred_api?.length ? { preferred_api: alias.preferred_api } : {}),
    ...(alias.type && { type: alias.type }),
    ...(alias.advanced?.length ? { advanced: alias.advanced } : {}),
    ...(alias.metadata && { metadata: alias.metadata }),
    ...(alias.pi_model && { pi_model: alias.pi_model }),
    ...(alias.extraBody && Object.keys(alias.extraBody).length > 0
      ? { extraBody: alias.extraBody }
      : {}),
    target_groups: targetGroups.map((group) => ({
      name: group.name,
      selector: group.selector,
      targets: group.targets.map((target) =>
        target.alias
          ? {
              alias: target.alias,
              ...(target.enabled === false && { enabled: false }),
            }
          : {
              provider: target.provider,
              model: target.model,
              ...(target.enabled === false && { enabled: false }),
            }
      ),
    })),
  };
}

export const getAffectedAliases = async (
  providerId: string
): Promise<{ aliasId: string; targetsCount: number }[]> => {
  try {
    const aliases = await getAliases();
    const affected: { aliasId: string; targetsCount: number }[] = [];

    for (const alias of aliases) {
      const targetsCount = alias.target_groups.reduce(
        (sum, g) => sum + g.targets.filter((t) => t.provider === providerId).length,
        0
      );
      if (targetsCount > 0) {
        affected.push({ aliasId: alias.id, targetsCount });
      }
    }

    return affected;
  } catch (e) {
    console.error('API Error getAffectedAliases', e);
    return [];
  }
};

export const deleteAlias = async (aliasId: string): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/models/${encodeURIComponent(aliasId)}`,
    {
      method: 'DELETE',
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to delete alias');
  }
};

export const deleteAllAliases = async (): Promise<void> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/models`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to delete all aliases');
  }
};

export const saveAlias = async (alias: Alias, oldId?: string): Promise<void> => {
  const body = aliasToConfigPayload(alias);

  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/aliases/${encodeURIComponent(alias.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: Array<{ message?: string }>;
    };
    const detail =
      Array.isArray(err.details) && err.details[0]?.message ? `: ${err.details[0].message}` : '';
    throw new Error(`${err.error || 'Failed to save alias'}${detail}`);
  }

  // Delete old alias only after new one is saved successfully
  if (oldId && oldId !== alias.id) {
    await deleteAlias(oldId);
  }
};

export const previewModelResolution = async (alias: Alias): Promise<ModelResolutionPreview> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/models/metadata/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias_id: alias.id, model: aliasToConfigPayload(alias) }),
  });
  if (!res.ok) throw new Error('Failed to resolve automatic model selections');
  return res.json();
};

export const getModels = async (): Promise<Model[]> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/providers`);
    if (!res.ok) throw new Error('Failed to fetch providers');
    const providers = (await res.json()) as Record<
      string,
      {
        models?:
          | string[]
          | Record<
              string,
              {
                pricing?: { source?: string };
                type?: 'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image';
              }
            >;
      }
    >;
    const models: Model[] = [];

    // Extract models from providers
    Object.entries(providers).forEach(([pKey, pVal]) => {
      if (pVal.models) {
        if (Array.isArray(pVal.models)) {
          pVal.models.forEach((m: string) => {
            models.push({
              id: m,
              name: m,
              providerId: pKey,
            });
          });
        } else if (typeof pVal.models === 'object') {
          Object.entries(pVal.models).forEach(([mKey, mVal]) => {
            models.push({
              id: mKey,
              name: mKey,
              providerId: pKey,
              pricingSource: mVal.pricing?.source,
              type: mVal.type,
            });
          });
        }
      }
    });
    return dedupeModels(models);
  } catch (e) {
    console.error('API Error getModels', e);
    return [];
  }
};

export const getAliases = async (): Promise<Alias[]> => {
  try {
    const [aliasRes, providerRes] = await Promise.all([
      fetchWithAuth(`${API_BASE}/v0/management/aliases`),
      fetchWithAuth(`${API_BASE}/v0/management/providers`),
    ]);
    if (!aliasRes.ok) throw new Error('Failed to fetch aliases');
    if (!providerRes.ok) throw new Error('Failed to fetch providers');

    interface RawTarget {
      alias?: string;
      provider?: string;
      model?: string;
      enabled?: boolean;
    }

    interface RawTargetGroup {
      name?: string;
      selector?: string;
      targets?: RawTarget[];
    }

    interface RawAliasRecord {
      additional_aliases?: string[];
      priority?: 'selector' | 'api_match';
      type?: 'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image';
      target_groups?: RawTargetGroup[];
      use_image_fallthrough?: boolean;
      enforce_limits?: boolean;
      sticky_session?: boolean;
      advanced?: Alias['advanced'];
      metadata?: Alias['metadata'];
      preferred_api?: Alias['preferred_api'];
      pi_model?: Alias['pi_model'];
      extraBody?: Record<string, unknown>;
    }

    interface RawProviderRecord {
      type?: string | string[];
      api_base_url?: string | Record<string, string>;
      models?: Record<string, { access_via?: string[] }>;
    }

    const aliasMap = (await aliasRes.json()) as Record<string, RawAliasRecord>;
    const providers = (await providerRes.json()) as Record<string, RawProviderRecord>;
    const aliases: Alias[] = [];

    Object.entries(aliasMap).forEach(([key, val]) => {
      const readTarget = (t: RawTarget) => {
        if (t.alias) {
          return {
            alias: t.alias as string,
            enabled: t.enabled !== false,
          };
        }

        const providerConfig = t.provider ? providers[t.provider] : undefined;
        const inferredTypes =
          providerConfig?.type || inferProviderTypes(providerConfig?.api_base_url);
        let apiType: string | string[] = inferredTypes;
        if (t.model && providerConfig?.models && !Array.isArray(providerConfig.models)) {
          const modelConfig = providerConfig.models[t.model];
          if (modelConfig?.access_via && modelConfig.access_via.length > 0) {
            apiType = normalizeApiAccessList(modelConfig.access_via);
          }
        }
        return {
          provider: t.provider,
          model: t.model,
          apiType: Array.isArray(apiType) ? apiType : [apiType],
          enabled: t.enabled !== false,
        };
      };

      const targetGroups: AliasTargetGroup[] = (val.target_groups || []).map((g) => ({
        name: g.name || 'default',
        selector: g.selector || 'random',
        targets: (g.targets || []).map(readTarget),
      }));

      aliases.push({
        id: key,
        aliases: val.additional_aliases || [],
        priority: val.priority,
        type: val.type,
        target_groups: targetGroups,
        use_image_fallthrough: val.use_image_fallthrough || false,
        enforce_limits: val.enforce_limits || false,
        sticky_session: val.sticky_session ?? true,
        advanced: val.advanced || [],
        metadata: val.metadata,
        preferred_api: val.preferred_api || [],
        pi_model: val.pi_model,
        extraBody:
          val.extraBody && typeof val.extraBody === 'object' && !Array.isArray(val.extraBody)
            ? val.extraBody
            : {},
      });
    });
    return aliases;
  } catch (e) {
    console.error('API Error getAliases', e);
    return [];
  }
};

export const testModel = async (
  provider: string,
  model: string,
  apiType?: string
): Promise<{
  success: boolean;
  error?: string;
  durationMs: number | null;
  response?: string;
  apiType?: string;
}> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, apiType }),
    });
    if (!res.ok) throw new Error('Failed to test model');
    return await res.json();
  } catch (e) {
    console.error('API Error testModel', e);
    throw e;
  }
};

/**
 * Search external model metadata catalogs (OpenRouter, models.dev, catwalk)
 * via the backend catalog cache.
 */
export const searchModelMetadata = async (
  source: CatalogMetadataSource,
  query?: string,
  limit?: number
): Promise<{ data: { id: string; name: string }[]; count: number }> => {
  const params = new URLSearchParams({ source });
  if (query) params.set('q', query);
  if (limit !== undefined) params.set('limit', String(limit));
  const res = await fetch(`${API_BASE}/v1/metadata/search?${params}`);
  if (!res.ok) {
    // 503 means the source isn't loaded yet — return empty gracefully
    if (res.status === 503) return { data: [], count: 0 };
    throw new Error(`Failed to search model metadata: ${res.statusText}`);
  }
  const result = (await res.json()) as {
    data: { id: string; name: string }[];
    count: number;
  };
  const data = dedupeById(result.data);
  return { data, count: data.length };
};

/**
 * Look up full catalog metadata for a specific model. Returns null when the
 * source has not loaded (503) or the source_path is not found (404) so callers
 * can gracefully fall back to leaving the form blank.
 */
export const getModelMetadata = async (
  source: CatalogMetadataSource,
  sourcePath: string
): Promise<NormalizedModelMetadata | null> => {
  const params = new URLSearchParams({ source, source_path: sourcePath });
  const res = await fetch(`${API_BASE}/v1/metadata/lookup?${params}`);
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) {
    throw new Error(`Failed to look up model metadata: ${res.statusText}`);
  }
  const json = (await res.json()) as { data: NormalizedModelMetadata };
  return json.data;
};

export const refreshModelMetadata = async (): Promise<ModelMetadataRefreshResult> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/models/metadata/refresh`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to refresh model metadata');
  }
  return (await res.json()) as ModelMetadataRefreshResult;
};

export const getPiProviders = async (): Promise<string[]> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/pi/providers`);
  if (!res.ok) throw new Error('Failed to fetch pi providers');
  const json = (await res.json()) as { data: string[] };
  return json.data;
};

export const getPiModels = async (
  provider: string,
  q?: string
): Promise<Array<{ id: string; name: string; api: string; custom: boolean }>> => {
  const params = new URLSearchParams({ provider });
  if (q) params.set('q', q);
  const res = await fetchWithAuth(`${API_BASE}/v0/management/pi/models?${params}`);
  if (!res.ok) throw new Error('Failed to fetch pi models');
  const json = (await res.json()) as {
    data: Array<{ id: string; name: string; api: string; custom: boolean }>;
  };
  return dedupeById(json.data);
};

export const getVisionFallthroughConfig = async (): Promise<{
  descriptor_model?: string;
  default_prompt?: string;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/vision-fallthrough`);
  if (!res.ok) throw new Error('Failed to fetch vision fallthrough config');
  return res.json();
};

export const updateVisionFallthroughConfig = async (updates: {
  descriptor_model?: string;
  default_prompt?: string;
}): Promise<Record<string, unknown>> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/vision-fallthrough`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update vision fallthrough config');
  return res.json();
};
