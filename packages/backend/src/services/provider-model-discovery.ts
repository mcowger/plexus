import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { getProviderTypes, type ProviderConfig } from '../config';
import { logger } from '../utils/logger';

export interface DiscoveredModel {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  object?: string;
  owned_by?: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
}

export function validateUrlSafety(url: string): { valid: boolean; error?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, error: 'Only http and https URLs are allowed' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return { valid: false, error: 'Cannot fetch from localhost' };
  }

  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.azure.internal'
  ) {
    return { valid: false, error: 'Cannot fetch from cloud metadata endpoints' };
  }

  logger.debug(`Fetch request to: ${hostname}`);
  return { valid: true };
}

export function normalizeModelsResponse(data: any): { data: DiscoveredModel[] } {
  if (data && Array.isArray(data.data)) {
    return { data: data.data };
  }

  if (data && Array.isArray(data.models)) {
    const convertedModels = data.models.map((model: any) => {
      if (typeof model === 'string') {
        return { id: model, object: 'model', created: Date.now(), owned_by: 'ollama' };
      }
      return {
        id: model.name || model.id || model.model,
        object: 'model',
        created: model.modified_at
          ? new Date(model.modified_at).getTime() / 1000
          : Date.now() / 1000,
        owned_by: 'ollama',
        ...model,
      };
    });
    return { data: convertedModels };
  }

  if (data && !data.data && !data.models) {
    logger.warn('Unknown models response format, wrapping in data array');
    return { data: [data] };
  }

  return { data: [] };
}

export async function fetchModelsFromUrl(
  url: string,
  apiKey?: string
): Promise<{ data: DiscoveredModel[] }> {
  const urlValidation = validateUrlSafety(url);
  if (!urlValidation.valid) {
    throw new Error(urlValidation.error || 'Invalid URL');
  }

  const requestHeaders: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;

  logger.debug(`Fetching models from ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
      redirect: 'manual',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Provider returned ${response.status}: ${response.statusText}`);
      (error as any).statusCode = response.status;
      (error as any).details = errorText.substring(0, 500);
      throw error;
    }

    return normalizeModelsResponse(await response.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getOAuthProviderModels(providerId: string): DiscoveredModel[] {
  return getBuiltinModels(providerId as any).map((model) => ({
    id: model.id,
    name: model.name,
    context_length: model.contextWindow,
    pricing: model.cost
      ? {
          prompt: model.cost.input.toString(),
          completion: model.cost.output.toString(),
        }
      : undefined,
  }));
}

export function deriveModelsUrl(provider: ProviderConfig): string | null {
  if (typeof provider.api_base_url === 'string') {
    const types = getProviderTypes(provider);
    if (types.length === 1 && types[0] === 'chat') {
      return `${provider.api_base_url.replace(/\/chat\/completions\/?$/, '')}/models`;
    }
    return null;
  }

  const apiBaseUrl = provider.api_base_url as Record<string, string>;
  if (apiBaseUrl.ollama) return 'https://ollama.com/api/tags';
  if (apiBaseUrl.chat) return `${apiBaseUrl.chat.replace(/\/chat\/completions\/?$/, '')}/models`;
  return null;
}

export async function discoverProviderModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  if (provider.oauth_provider) {
    return getOAuthProviderModels(provider.oauth_provider);
  }

  const modelsUrl = deriveModelsUrl(provider);
  if (!modelsUrl) return [];

  const apiKey = modelsUrl === 'https://ollama.com/api/tags' ? undefined : provider.api_key;
  const result = await fetchModelsFromUrl(modelsUrl, apiKey);
  return result.data;
}

export async function discoverProviderModelIds(provider: ProviderConfig): Promise<string[]> {
  const models = await discoverProviderModels(provider);
  return Array.from(
    new Set(models.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  ).sort((a, b) => a.localeCompare(b));
}
