import type { Model as PiAiModel, OAuthProvider } from '@mariozechner/pi-ai';
import { PI_AI_REQUEST_FILTERS } from './pi-ai-request-filter-rules';

export interface PiAiRequestFilterRule {
  provider: OAuthProvider | string;
  model: string;
  strippedParameters: string[];
  comment: string;
}

export function filterPiAiRequestOptions(
  options: Record<string, unknown>,
  model: PiAiModel<any>
): { filteredOptions: Record<string, unknown>; strippedParameters: string[] } {
  const matches = PI_AI_REQUEST_FILTERS.filter(
    (rule: PiAiRequestFilterRule) => rule.provider === model.provider && rule.model === model.id
  );

  if (matches.length === 0) {
    return { filteredOptions: options, strippedParameters: [] };
  }

  const filteredOptions = { ...options };
  const stripped = new Set<string>();

  for (const rule of matches) {
    for (const param of rule.strippedParameters) {
      if (param in filteredOptions) {
        delete filteredOptions[param];
        stripped.add(param);
      }
    }
  }

  return { filteredOptions, strippedParameters: Array.from(stripped) };
}
