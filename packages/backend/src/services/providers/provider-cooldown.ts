import { getProviderTypes } from '../../config';
import { logger } from '../../utils/logger';
import { CooldownParserRegistry } from '../runtime/cooldown-parsers';
import type { RouteResult } from '../routing/router';

export function resolveCooldownProviderType(route: RouteResult): string | undefined {
  if (typeof route.config.oauth_provider === 'string' && route.config.oauth_provider.trim()) {
    return route.config.oauth_provider.trim();
  }

  if (typeof route.config.pi_ai_provider === 'string' && route.config.pi_ai_provider.trim()) {
    return route.config.pi_ai_provider.trim();
  }

  const providerName = route.provider.toLowerCase();
  if (providerName.includes('openrouter')) {
    return 'openrouter';
  }

  if (typeof route.config.api_base_url === 'string') {
    const url = route.config.api_base_url.toLowerCase();
    if (url.includes('openrouter.ai')) {
      return 'openrouter';
    }
  }

  return getProviderTypes(route.config)[0];
}

export function parseCooldownDurationForProvider(
  providerType: string | undefined,
  errorText: string,
  source: 'HTTP' | 'OAuth'
): number | undefined {
  if (providerType) {
    const parsedDuration = CooldownParserRegistry.parseCooldown(providerType, errorText);

    if (parsedDuration !== null) {
      logger.info(
        `${source}: Parsed cooldown duration for ${providerType}: ${parsedDuration}ms (${parsedDuration / 1000}s)`
      );
      return parsedDuration;
    }
  }

  // Fallback: check if error text contains OpenRouter-specific markers
  if (
    errorText.includes('openrouter.ai') ||
    errorText.includes('retry_after_seconds') ||
    errorText.includes('is_byok')
  ) {
    const openrouterDuration = CooldownParserRegistry.parseCooldown('openrouter', errorText);
    if (openrouterDuration !== null) {
      logger.info(
        `${source}: Parsed OpenRouter cooldown duration from error body: ${openrouterDuration}ms (${openrouterDuration / 1000}s)`
      );
      return openrouterDuration;
    }
  }

  logger.debug(
    `${source}: No cooldown duration parsed for ${providerType || 'unknown'}, using default`
  );
  return undefined;
}
