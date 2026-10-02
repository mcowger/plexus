import type { UnifiedChatRequest } from '../../types/unified';
import { getApiBaseType } from '../../utils/api-format';
import { logger } from '../../utils/logger';

/**
 * `service_tier` only exists on OpenAI-style wire bodies. Anthropic Messages defines its own
 * `service_tier` with a different vocabulary and Gemini has none, so a tier chosen through an
 * `@<tier>` model-name suffix is applied to these target API types only.
 */
const SERVICE_TIER_API_TYPES = new Set(['chat', 'responses']);

/**
 * Apply the service tier selected by an `@<tier>` model-name suffix to the upstream body.
 *
 * The suffix is the most specific thing the client said, so it replaces a `service_tier` already
 * in the body. Provider, model, and alias `extraBody` are merged after this and still win.
 */
export function applyServiceTierSelection(
  payload: any,
  request: UnifiedChatRequest,
  targetApiType: string
): any {
  const tier = request.serviceTier;
  if (!tier) return payload;

  if (!SERVICE_TIER_API_TYPES.has(getApiBaseType(targetApiType))) {
    logger.debug(
      `Service tier '${tier}' not applied: ${targetApiType} bodies have no service_tier`
    );
    return payload;
  }

  return { ...payload, service_tier: tier };
}
