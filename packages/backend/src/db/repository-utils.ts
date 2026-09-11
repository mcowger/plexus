import { getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import { encrypt, decrypt } from '../utils/encryption';
import type { MetadataOverrides } from '../config';

/** Parse SQLite JSON text while accepting already-deserialized PostgreSQL jsonb values. */
export function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      // PostgreSQL jsonb can return plain strings without JSON quoting.
      return value as unknown as T;
    }
  }
  return null;
}

/** Serialize values for the active database dialect. */
export function toJson(value: unknown): string | unknown {
  if (value === null || value === undefined) return null;
  return getCurrentDialect() === 'sqlite' ? JSON.stringify(value) : value;
}

type AdapterEntry = {
  name: string;
  options: Record<string, unknown>;
  enabled: boolean;
};

export function normalizeAdapterEntries(raw: unknown): AdapterEntry[] | null {
  if (raw === null || raw === undefined) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  if (arr.length === 0) return null;

  return arr
    .map((entry): AdapterEntry | null => {
      if (typeof entry === 'string') {
        return { name: entry, options: {}, enabled: true };
      }
      if (entry && typeof entry === 'object' && 'name' in entry) {
        const record = entry as Record<string, unknown>;
        if (typeof record.name !== 'string') {
          logger.warn(`Skipping malformed adapter entry: ${JSON.stringify(entry)}`);
          return null;
        }
        return {
          name: record.name,
          options:
            record.options && typeof record.options === 'object'
              ? (record.options as Record<string, unknown>)
              : {},
          enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
        };
      }
      logger.warn(`Skipping malformed adapter entry: ${JSON.stringify(entry)}`);
      return null;
    })
    .filter((entry): entry is AdapterEntry => entry !== null);
}

/** Encrypt a JSON value for a TEXT column. */
export function encryptJsonField(value: unknown): string {
  if (value === null || value === undefined) return null as unknown as string;
  const strValue = typeof value === 'string' ? value : JSON.stringify(value);
  return encrypt(strValue);
}

/** Decrypt a JSON value, accepting encrypted text, plain JSON text, and jsonb values. */
export function decryptJsonField<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const decrypted = decrypt(value);
    try {
      return JSON.parse(decrypted) as T;
    } catch {
      return decrypted as unknown as T;
    }
  }
  if (typeof value === 'object') return value as T;
  return null;
}

export function hasAnyOverrideField(overrides: MetadataOverrides): boolean {
  if (overrides.name !== undefined) return true;
  if (overrides.description !== undefined) return true;
  if (overrides.context_length !== undefined) return true;
  if (overrides.pricing && Object.values(overrides.pricing).some((value) => value !== undefined)) {
    return true;
  }
  if (overrides.architecture) {
    if (overrides.architecture.tokenizer !== undefined) return true;
    if (overrides.architecture.input_modalities !== undefined) return true;
    if (overrides.architecture.output_modalities !== undefined) return true;
  }
  if (overrides.supported_parameters !== undefined) return true;
  if (
    overrides.top_provider &&
    Object.values(overrides.top_provider).some((v) => v !== undefined)
  ) {
    return true;
  }
  return false;
}

interface MetadataOverrideRow {
  name: string | null;
  description: string | null;
  contextLength: number | null;
  pricingPrompt: string | null;
  pricingCompletion: string | null;
  pricingInputCacheRead: string | null;
  pricingInputCacheWrite: string | null;
  architectureInputModalities: unknown;
  architectureOutputModalities: unknown;
  architectureTokenizer: string | null;
  supportedParameters: unknown;
  topProviderContextLength: number | null;
  topProviderMaxCompletionTokens: number | null;
}

export function overrideRowToOverrides(row: MetadataOverrideRow): MetadataOverrides {
  const overrides: MetadataOverrides = {};
  if (row.name != null) overrides.name = row.name;
  if (row.description != null) overrides.description = row.description;
  if (row.contextLength != null) overrides.context_length = row.contextLength;

  const pricing: MetadataOverrides['pricing'] = {};
  if (row.pricingPrompt != null) pricing.prompt = row.pricingPrompt;
  if (row.pricingCompletion != null) pricing.completion = row.pricingCompletion;
  if (row.pricingInputCacheRead != null) pricing.input_cache_read = row.pricingInputCacheRead;
  if (row.pricingInputCacheWrite != null) pricing.input_cache_write = row.pricingInputCacheWrite;
  if (Object.keys(pricing).length > 0) overrides.pricing = pricing;

  const architecture: MetadataOverrides['architecture'] = {};
  const inputMods = parseJson<string[]>(row.architectureInputModalities);
  const outputMods = parseJson<string[]>(row.architectureOutputModalities);
  if (inputMods && Array.isArray(inputMods)) architecture.input_modalities = inputMods;
  if (outputMods && Array.isArray(outputMods)) architecture.output_modalities = outputMods;
  if (row.architectureTokenizer != null) architecture.tokenizer = row.architectureTokenizer;
  if (Object.keys(architecture).length > 0) overrides.architecture = architecture;

  const supportedParams = parseJson<string[]>(row.supportedParameters);
  if (supportedParams && Array.isArray(supportedParams)) {
    overrides.supported_parameters = supportedParams;
  }

  const topProvider: MetadataOverrides['top_provider'] = {};
  if (row.topProviderContextLength != null) {
    topProvider.context_length = row.topProviderContextLength;
  }
  if (row.topProviderMaxCompletionTokens != null) {
    topProvider.max_completion_tokens = row.topProviderMaxCompletionTokens;
  }
  if (Object.keys(topProvider).length > 0) overrides.top_provider = topProvider;

  return overrides;
}

export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return value === 1 || value === true;
}

export function fromBool(value: boolean): number | boolean {
  return getCurrentDialect() === 'sqlite' ? (value ? 1 : 0) : value;
}

export function now(): number {
  return Date.now();
}

export function parseStringArray(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;

    const normalized = parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);

    return normalized.length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function stringifyStringArray(value: string[] | undefined): string | null {
  if (!value || value.length === 0) return null;

  const normalized = value.map((entry) => entry.trim()).filter(Boolean);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

/** Preserve an explicitly empty quota list as authoritative `[]`. */
export function stringifyQuotaNames(value: string[] | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.map((entry) => entry.trim()).filter(Boolean);
  return JSON.stringify(normalized);
}

/** Resolve the authoritative multi-quota column with legacy single-quota fallback. */
export function quotasFromRow(row: {
  quotaNames: string | null;
  quotaName: string | null;
}): string[] | undefined {
  if (row.quotaNames != null) return parseStringArray(row.quotaNames) ?? [];
  return row.quotaName ? [row.quotaName] : undefined;
}
