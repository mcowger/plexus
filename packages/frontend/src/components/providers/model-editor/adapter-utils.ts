export type AdapterEntry = string | Record<string, any>;
export const CACHE_RESPONSES_INSTRUCTIONS_ADAPTER = 'cache_responses_instructions';

export const KNOWN_ADAPTERS: { value: string; label: string; description: string }[] = [
  {
    value: 'reasoning_content',
    label: 'Reasoning Content',
    description:
      'Maps reasoning ↔ reasoning_content on messages and responses (e.g. Fireworks DeepSeek-R1).',
  },
  {
    value: 'suppress_developer_role',
    label: 'Suppress Developer Role',
    description: 'Rewrites the "developer" role to "system" for providers that do not support it.',
  },
  {
    value: CACHE_RESPONSES_INSTRUCTIONS_ADAPTER,
    label: 'Cache Responses Instructions',
    description:
      'Moves top-level Responses instructions into a leading developer message for prompt caching. Auto-enabled for known GPT-6.2–6.5 OpenAI, Codex, and Copilot targets.',
  },
  {
    value: 'model_override',
    label: 'Model Override',
    description:
      'Conditionally rewrites the model name based on request fields (e.g. switching to a -fast variant when reasoning is disabled).',
  },
  {
    value: 'reasoning_rewrite',
    label: 'Reasoning Rewrite',
    description:
      'Rewrites reasoning/thinking fields to provider-specific formats (e.g. enable_thinking, budget_tokens, thinking.type).',
  },
  {
    value: 'web_search_coercion',
    label: 'Web Search Coercion',
    description:
      'Coerces server-side web search tool entries to the format expected by this provider (Anthropic, OpenAI, or OpenRouter).',
  },
];

export function normalizeAdapterEntries(value: unknown): AdapterEntry[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value as AdapterEntry];
}

export function getAdapterName(entry: unknown): string | undefined {
  return typeof entry === 'string'
    ? entry
    : entry && typeof entry === 'object' && typeof (entry as Record<string, any>).name === 'string'
      ? (entry as Record<string, any>).name
      : undefined;
}

export type AdapterMode = 'auto' | 'on' | 'off';

export function getAdapterMode(entries: AdapterEntry[], name: string): AdapterMode {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (getAdapterName(entry) !== name) continue;
    if (typeof entry !== 'string' && entry.enabled === false) return 'off';
    return 'on';
  }
  return 'auto';
}

export function setAdapterMode(
  entries: AdapterEntry[],
  name: string,
  mode: AdapterMode
): AdapterEntry[] {
  const withoutEntry = entries.filter((entry) => getAdapterName(entry) !== name);
  if (mode === 'auto') return withoutEntry;
  return [{ name, options: {}, enabled: mode === 'on' }, ...withoutEntry];
}

export function renameRecordKey<T>(record: Record<string, T>, oldKey: string, newKey: string) {
  if (oldKey === newKey) return record;
  const next = { ...record };
  if (Object.prototype.hasOwnProperty.call(next, oldKey)) {
    next[newKey] = next[oldKey];
    delete next[oldKey];
  }
  return next;
}

export function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}
