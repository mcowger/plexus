import type { ProviderAdapter } from '../../types/provider-adapter';
import { reasoningContentAdapter } from './reasoning-content.adapter';
import { suppressDeveloperRoleAdapter } from './suppress-developer-role.adapter';
import { modelOverrideAdapter } from './model-override.adapter';
import { reasoningRewriteAdapter } from './reasoning-rewrite.adapter';

/**
 * Registry of all built-in provider adapters.
 * Keys must match the name field used in provider/model config `adapter` entries.
 */
export const ADAPTER_REGISTRY: Record<string, ProviderAdapter> = {
  [reasoningContentAdapter.name]: reasoningContentAdapter,
  [suppressDeveloperRoleAdapter.name]: suppressDeveloperRoleAdapter,
  [modelOverrideAdapter.name]: modelOverrideAdapter,
  [reasoningRewriteAdapter.name]: reasoningRewriteAdapter,
};
