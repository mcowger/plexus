import { getProviderTypes } from '../../config';
import { logger } from '../../utils/logger';
import { getApiBaseType, isApiSubtype, normalizeApiAccessList } from '../../utils/api-format';
import type { RouteResult } from '../routing/router';

/**
 * Request-level API types (e.g. embeddings, transcriptions) share base URLs
 * with their provider-level counterparts (e.g. chat, gemini). This map defines
 * which provider-level URL keys to try when no exact or default URL is configured.
 */
const API_TYPE_ALIASES: Record<string, string[]> = {
  completions: ['completions', 'chat', 'gemini'],
  embeddings: ['chat', 'gemini'],
  transcriptions: ['chat', 'gemini'],
  speech: ['chat', 'gemini'],
  images: ['chat', 'gemini'],
};

function stripTrailingApiVersion(url: string): string {
  return url.replace(/\/(v\d+beta\d*)$/i, '');
}

export function getApiMetadata(metadata: Record<string, any>): Record<string, any> {
  const { plexus_metadata: _stripped, ...apiMetadata } = metadata || {};
  return apiMetadata;
}

/**
 * Determines which API type to use based on configuration and incoming request type
 * @returns Selected API type and human-readable reason for selection
 */
export function selectTargetApiType(
  route: RouteResult,
  incomingApiType?: string
): { targetApiType?: string; selectionReason: string } {
  const providerTypes = getProviderTypes(route.config);

  // Check if model specific access_via is defined
  const modelSpecificTypes = route.modelConfig?.access_via;

  // The available types for this specific routing
  // If model specific types are defined and not empty, use them. Otherwise fallback to provider types.
  const availableTypes =
    modelSpecificTypes && modelSpecificTypes.length > 0
      ? normalizeApiAccessList(modelSpecificTypes)
      : providerTypes;

  let targetApiType = availableTypes[0]; // Default to first one

  if (!targetApiType) {
    throw new Error(
      `No available API type found for provider '${route.provider}' and model '${route.model}'. Check configuration.`
    );
  }
  let selectionReason = 'default (first available)';

  // Try to match incoming
  if (incomingApiType) {
    const incoming = incomingApiType.toLowerCase();
    // Case-insensitive match
    const match = availableTypes.find((t: string) => t.toLowerCase() === incoming);
    if (match) {
      targetApiType = match;
      selectionReason = `matched incoming request type '${incoming}'`;
    } else if (isApiSubtype(incoming)) {
      // No exact subtype match (e.g. "responses:lite"): Plexus fully
      // translates the subtype's wire extensions via the transform
      // pipeline, so a target advertising only the base type (e.g.
      // "responses") is still usable as a fallback. If the target
      // doesn't even support the base type, fall through to the
      // default (first available) type — the transform pipeline
      // handles cross-format translation (e.g. to chat completions)
      // the same way it would for any other incoming type.
      const baseType = getApiBaseType(incoming);
      const baseMatch = availableTypes.find((t: string) => t.toLowerCase() === baseType);
      if (baseMatch) {
        targetApiType = baseMatch;
        selectionReason = `incoming API subtype '${incoming}' not directly supported, fell back to base type '${baseType}'`;
      } else {
        selectionReason = `incoming API subtype '${incoming}' not supported, defaulted to '${targetApiType}'`;
      }
    } else {
      selectionReason = `incoming type '${incoming}' not supported, defaulted to '${targetApiType}'`;
    }
  }

  return { targetApiType, selectionReason };
}

/**
 * Resolves the provider base URL from configuration, handling both string and record formats
 * @returns Normalized base URL without trailing slash
 */
export function resolveProviderBaseUrl(route: RouteResult, targetApiType: string): string {
  let rawBaseUrl: string;

  if (typeof route.config.api_base_url === 'string') {
    rawBaseUrl = route.config.api_base_url;
  } else {
    // It's a record/map
    const urlMap = route.config.api_base_url;
    const typeKey = targetApiType.toLowerCase();
    // Check exact match first, then fallback to just looking for keys that might match?
    // Actually the config keys should probably match the api types (chat, messages, etc)
    const specificUrl = urlMap[typeKey] || urlMap[getApiBaseType(typeKey)];
    const defaultUrl = urlMap['default'];

    if (specificUrl) {
      rawBaseUrl = specificUrl;
      logger.debug(`Dispatcher: Using specific base URL for '${targetApiType}'.`);
    } else if (defaultUrl) {
      rawBaseUrl = defaultUrl;
      logger.debug(`Dispatcher: Using default base URL.`);
    } else {
      // Resolve via API_TYPE_ALIASES before falling back to the first key.
      const aliases = API_TYPE_ALIASES[typeKey];
      const aliasKey = aliases?.find((a) => urlMap[a]);

      if (aliasKey) {
        rawBaseUrl = urlMap[aliasKey]!;
        logger.debug(`Dispatcher: Using '${aliasKey}' base URL for api type '${targetApiType}'.`);
      } else {
        const firstKey = Object.keys(urlMap)[0];

        if (firstKey) {
          const firstUrl = urlMap[firstKey];
          if (firstUrl) {
            rawBaseUrl = firstUrl;
            logger.warn(
              `No specific base URL found for api type '${targetApiType}'. using '${firstKey}' as fallback.`
            );
          } else {
            throw new Error(
              `No base URL configured for api type '${targetApiType}' and no default found.`
            );
          }
        } else {
          throw new Error(
            `No base URL configured for api type '${targetApiType}' and no default found.`
          );
        }
      }
    }
  }

  // Ensure api_base_url doesn't end with slash and strip trailing /v1beta if present
  // (the transformer adds its own /v1beta path segment)
  return stripTrailingApiVersion(rawBaseUrl.replace(/\/$/, ''));
}

/**
 * Converts reasoning field to thinkingConfig for Gemini API.
 * Gemini's OpenAI-compatible endpoint doesn't support 'reasoning' at top level,
 * so we map request.reasoning.effort to generationConfig.thinkingConfig instead.
 */
export function applyGeminiThinkingConfig(
  route: RouteResult,
  targetApiType: string,
  payload: any
): any {
  const baseUrl = resolveProviderBaseUrl(route, targetApiType).toLowerCase();
  const isGemini = baseUrl.includes('generativelanguage.googleapis.com');
  const enabled = route.config.geminiThinkingEnabled === true;

  // Gemini's OpenAI-compatible endpoint doesn't support 'reasoning' at top level
  // Always strip it, and if enabled, map reasoning.effort to thinkingConfig
  if (isGemini && payload.reasoning && enabled) {
    const { reasoning, ...restPayload } = payload;
    const result: any = { ...restPayload };

    // Map reasoning.effort to Gemini's thinkingLevel
    // OpenAI ThinkLevel: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    // Gemini ThinkingLevel: 'low' | 'medium' | 'high'
    const effort = reasoning?.effort;
    if (effort && effort !== 'none' && effort !== 'minimal') {
      let thinkingLevel: 'low' | 'medium' | 'high';
      if (effort === 'low') {
        thinkingLevel = 'low';
      } else if (effort === 'medium') {
        thinkingLevel = 'medium';
      } else {
        // 'high' or 'xhigh' map to 'high'
        thinkingLevel = 'high';
      }

      result.generationConfig = {
        ...payload.generationConfig,
        thinkingConfig: {
          thinkingLevel,
        },
      };
    }

    return result;
  } else if (isGemini && payload.reasoning) {
    // Config not enabled but have reasoning - just strip it
    const { reasoning: _, ...restPayload } = payload;
    return restPayload;
  }

  return payload;
}
