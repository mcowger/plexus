import { getConfig } from '../../config';
import type { AuthProvider } from './types';
import { PlexusIdpProvider } from './plexus-idp-provider';

let cachedProvider: AuthProvider | null = null;
let cachedProviderId: string | null = null;

export function isMcpOAuthEnabled(): boolean {
  return getConfig().mcpOAuth?.enabled === true;
}

export function getMcpAuthProvider(): AuthProvider | null {
  const config = getConfig().mcpOAuth;
  if (config?.enabled !== true) return null;

  const providerId = config.provider ?? 'plexus-idp';
  if (cachedProvider && cachedProviderId === providerId) return cachedProvider;

  switch (providerId) {
    case 'plexus-idp':
      cachedProvider = new PlexusIdpProvider();
      cachedProviderId = providerId;
      return cachedProvider;
    default:
      return null;
  }
}

export function resetMcpAuthProviderForTesting(): void {
  cachedProvider = null;
  cachedProviderId = null;
}
