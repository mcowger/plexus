import { getCatalogModels } from '../pi-ai/catalog';

const NATIVE_PROVIDERS = new Set(['minimax', 'minimax-cn']);
const GATEWAY_PROVIDERS = new Set(['openrouter', 'opencode', 'opencode-go']);
const CURRENT_IDS = ['MiniMax-M3.1-Flash', 'MiniMax-M3'] as const;

type Choice = { id: string; provider?: string; type?: string };

/** Curate discovery only. Saved/custom IDs continue through the normal dispatch path. */
export function selectMiniMaxChatChoices<T extends Choice>(
  models: readonly T[],
  provider?: string
): T[] {
  const rank = (model: T): number => {
    const owner = provider ?? model.provider;
    if (!owner || (!NATIVE_PROVIDERS.has(owner) && !GATEWAY_PROVIDERS.has(owner))) return 2;
    if (model.type && model.type !== 'chat' && model.type !== 'text') return 2;
    if (typeof model.id !== 'string') return 2;
    const id = model.id
      .toLowerCase()
      .replace(/^minimax\//, '')
      .replace(/:(?:free|nitro)$/, '');
    // Do not treat speech, image, video, or unrelated custom IDs as chat models.
    if (!/^(?:minimax-(?:m\d|text-|\d)|abab)/.test(id)) return 2;
    if (id === 'minimax-m3.1-flash' || id === 'minimax-m3.1-flash-free') return 0;
    if (id === 'minimax-m3') return 1;
    return -1;
  };
  return models.filter((model) => rank(model) >= 0).sort((a, b) => rank(a) - rank(b));
}

/** Native API IDs are known independently of pi-ai's bundled catalog version. */
export function getSuggestedChatModels(provider?: string) {
  const models: Array<{
    id: string;
    name: string;
    provider: string;
    api: string;
    reasoning?: boolean;
    contextWindow?: number;
    maxTokens?: number;
    cost?: ReturnType<typeof getCatalogModels>[number]['cost'];
  }> = [...getCatalogModels(provider)];
  for (const owner of NATIVE_PROVIDERS) {
    if (provider && provider !== owner) continue;
    for (const id of CURRENT_IDS) {
      if (!models.some((model) => model.provider === owner && model.id === id)) {
        // Leave unknown capability, pricing, and token-limit metadata absent.
        models.push({ id, name: id, provider: owner, api: 'anthropic-messages' });
      }
    }
  }
  return selectMiniMaxChatChoices(models, provider);
}

export function miniMaxDiscoveryProvider(url: string): string | undefined {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'api.minimax.io') return 'minimax';
  if (host === 'api.minimaxi.com') return 'minimax-cn';
  if (host === 'openrouter.ai' || host === 'api.kilo.ai') return 'openrouter';
  if (host === 'opencode.ai') return 'opencode';
  return undefined;
}
