import type { ProviderAdapter } from '../../types/provider-adapter';
import { reasoningContentAdapter } from './reasoning-content.adapter';
import { suppressDeveloperRoleAdapter } from './suppress-developer-role.adapter';

/**
 * Registry of all built-in provider adapters.
 * Keys must match the strings used in provider/model config `adapter` fields.
 */
export const ADAPTER_REGISTRY: Record<string, ProviderAdapter> = {
  [reasoningContentAdapter.name]: reasoningContentAdapter,
  [suppressDeveloperRoleAdapter.name]: suppressDeveloperRoleAdapter,
};
