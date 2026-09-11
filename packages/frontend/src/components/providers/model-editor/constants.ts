import type { CSSProperties } from 'react';

export type ApiAccessOption = { type: string; label: string };

export const API_ACCESS_OPTIONS: readonly ApiAccessOption[] = [
  { type: 'chat', label: 'chat' },
  { type: 'completions', label: 'completions' },
  { type: 'messages', label: 'messages' },
  { type: 'gemini', label: 'gemini' },
  { type: 'responses', label: 'responses' },
  { type: 'ollama', label: 'ollama' },
];

export const IMAGE_API_ACCESS_OPTIONS: readonly ApiAccessOption[] = [
  { type: 'chat', label: 'OpenAI-compatible' },
  { type: 'openai-images', label: 'OpenAI Images' },
  { type: 'openrouter-images', label: 'OpenRouter Images' },
  { type: 'gemini', label: 'Gemini Images' },
];

export const CODEX_IMAGE_API_ACCESS_OPTIONS: readonly ApiAccessOption[] = [
  { type: 'codex-images', label: 'Codex Images (ChatGPT OAuth)' },
];

export const CODEX_OAUTH_PROVIDER = 'openai-codex';
export const DEFAULT_IMAGE_ACCESS = 'openai-images';
export const CODEX_IMAGE_ACCESS = 'codex-images';
export const GPT5_SUPPRESSION_ADAPTER = 'suppress_unsupported_gpt5_options';

export const FIELD_CLS =
  'w-full h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary';

export function isGpt5Model(modelId: string): boolean {
  return /^gpt-5(?:[.-]|$)/i.test(modelId);
}

export function getApiBadgeStyle(apiType: string): CSSProperties {
  switch (apiType.toLowerCase()) {
    case 'messages':
      return { backgroundColor: '#D97757', color: 'white', border: 'none' };
    case 'chat':
      return { backgroundColor: '#ebebeb', color: '#333', border: 'none' };
    case 'completions':
      return { backgroundColor: '#3b82f6', color: 'white', border: 'none' };
    case 'gemini':
      return { backgroundColor: '#5084ff', color: 'white', border: 'none' };
    case 'embeddings':
      return { backgroundColor: '#10b981', color: 'white', border: 'none' };
    case 'transcriptions':
      return { backgroundColor: '#a855f7', color: 'white', border: 'none' };
    case 'speech':
      return { backgroundColor: '#f97316', color: 'white', border: 'none' };
    case 'openai-images':
      return { backgroundColor: '#d946ef', color: 'white', border: 'none' };
    case 'responses':
      return { backgroundColor: '#06b6d4', color: 'white', border: 'none' };
    case 'openrouter-images':
      return { backgroundColor: '#7c3aed', color: 'white', border: 'none' };
    case 'codex-images':
      return { backgroundColor: '#10a37f', color: 'white', border: 'none' };
    case 'ollama':
      return { backgroundColor: '#1a5f7a', color: 'white', border: 'none' };
    default:
      return {};
  }
}
