import { describe, expect, it } from 'vitest';

import { deriveShortName } from '../short-name';

describe('deriveShortName', () => {
  it.each([
    // Anthropic
    ['Anthropic: Claude Sonnet 5.5', undefined, 'Sonnet 5.5'],
    ['Claude Sonnet 4.5 (latest)', undefined, 'Sonnet 4.5'],
    ['Claude Haiku 4.5', undefined, 'Haiku 4.5'],
    // OpenAI
    ['OpenAI: GPT-6.1 Sol Pro', undefined, 'GPT 6.1 Sol Pro'],
    ['GPT-5 Mini', undefined, 'GPT 5 Mini'],
    ['GPT-5.4 nano', undefined, 'GPT 5.4 Nano'],
    ['GPT-5.3 Codex', undefined, 'GPT 5.3 Codex'],
    ['GPT-5.4 Codex Mini', undefined, 'GPT 5.4 Codex Mini'],
    ['o3 Mini High', undefined, 'o3 Mini High'],
    ['OpenAI: GPT-4o (2024-05-13)', undefined, 'GPT 4o'],
    ['o4-mini', 'openai/o4-mini', 'O4 Mini'],
    ['chatgpt-image-latest', 'openai/chatgpt-image-latest', 'ChatGPT Image'],
    // Google — Flash abbreviates everywhere, technical names win for Banana
    ['Google: Gemini 3.8 Flash', undefined, 'Gemini 3.8 F'],
    ['Gemini 2.5 Flash Lite', undefined, 'Gemini 2.5 F Lite'],
    ['Gemini Flash-Lite Latest', undefined, 'Gemini F Lite'],
    ['Google: Nano Banana 2 (Gemini 3.1 Flash Image)', undefined, 'Gemini 3.1 F Image'],
    ['Nano Banana 2', 'gemini-3.1-flash-image', 'Gemini 3.1 F Image'],
    ['Nano Banana 2', 'google.gemini-3.1-flash-image', 'Gemini 3.1 F Image'],
    ['Nano Banana Pro', 'gemini-3-pro-image', 'Gemini 3 Pro Image'],
    ['Nano Banana 2', undefined, 'Banana 2'],
    // Meta
    ['Meta: Llama 3.1 70B Instruct', undefined, 'Llama 3.1 70B'],
    ['Meta: Muse Spark 1.3', undefined, 'Spark 1.3'],
    ['Muse Wonder', undefined, 'Wonder'],
    // Meta/Muse OAuth: id-only input
    ['muse-spark-1.2', 'muse-spark-1.2', 'Spark 1.2'],
    [undefined, 'muse-spark-1.3-contributor', 'Spark 1.3 Contributor'],
    // DeepSeek — vendor folds to DS, Flash→F, Pro→P, dates dropped
    ['DeepSeek: DeepSeek V4.1 Flash', undefined, 'DS 4.1 F'],
    ['DeepSeek: DeepSeek V4.1 Flash 1017', undefined, 'DS 4.1 F'],
    ['DeepSeek V4.1 Flash', undefined, 'DS 4.1 F'],
    ['DeepSeek: R1', undefined, 'DS R1'],
    ['DeepSeek: R1 0528', undefined, 'DS R1'],
    ['DeepSeek: DeepSeek V4 Pro 0813', undefined, 'DS 4 P'],
    // Z.ai — separator normalization unifies hyphen/space forms
    ['Z.ai: GLM 5.3 Flash', undefined, 'GLM 5.3 F'],
    ['GLM-5.3-Flash', 'zai.glm-5.3-flash', 'GLM 5.3 F'],
    ['Z.ai: GLM 5.3 FlashX', undefined, 'GLM 5.3 FlashX'],
    // xAI — (Non-Reasoning) is load-bearing, abbreviated to (NR)
    ['SpaceXAI: Grok 4.7', undefined, 'Grok 4.7'],
    ['Grok 4.20 (Reasoning)', undefined, 'Grok 4.20 (R)'],
    ['Grok 4.20 (Non-Reasoning)', undefined, 'Grok 4.20 (NR)'],
    // Qwen — fused versions kept, date parens dropped, Thinking dropped
    ['Qwen: Qwen3.8 Max Prime', undefined, 'Qwen3.8 Max Prime'],
    ['Qwen: Qwen3.8 Max (0902)', undefined, 'Qwen3.8 Max'],
    ['Qwen3-Next 80B-A3B (Thinking)', undefined, 'Qwen3 Next 80B A3B'],
    ['Qwen3.5 Flash', undefined, 'Qwen3.5 F'],
    ['Qwen2.5 72B Instruct', undefined, 'Qwen2.5 72B'],
    // Mistral — umbrella kept except before distinct families
    ['Mistral: Mistral Large 4', undefined, 'Mistral Large 4'],
    ['Mistral: Codestral 2508', undefined, 'Codestral 2508'],
    ['Mistral Large (latest)', undefined, 'Mistral Large'],
    ['Devstral 2', undefined, 'Devstral 2'],
    ['Mistral: Mistral Nemo', undefined, 'Nemo'],
    ['Open Mistral Nemo', undefined, 'Nemo'],
    // OAuth / misc
    ['GPT-5.4 Codex Mini', undefined, 'GPT 5.4 Codex Mini'],
    ['Internal Preview', undefined, 'Internal Preview'],
    ['Kimi K2 Thinking', undefined, 'Kimi K2'],
    ['text-embedding-3-small', 'openai/text-embedding-3-small', 'Text Embedding 3 Small'],
    ['gpt-image-2', 'openai/gpt-image-2', 'GPT Image 2'],
    ['gpt-oss-120b', 'openai/gpt-oss-120b', 'GPT OSS 120B'],
    // Id variant suffixes select routing, not a different model
    ['openai/gpt-4o:free', undefined, 'GPT 4o'],
    ['anthropic/claude-sonnet-5-5:beta', undefined, 'Sonnet 5.5'],
    ['deepseek/deepseek-v4.1-flash:nitro', undefined, 'DS 4.1 F'],
    ['openai/gpt-4o-mini:batch', undefined, 'GPT 4o Mini'],
    // Generation branding keeps its case; sizes still uppercase
    ['gpt-4o', 'openai/gpt-4o', 'GPT 4o'],
    ['gpt-4o-mini', 'openai/gpt-4o-mini', 'GPT 4o Mini'],
    ['qwen3.8-2.4t-a95b', 'qwen/qwen3.8-2.4t-a95b', 'Qwen3.8 2.4T A95B'],
  ])('derives %j → %j', (name, id, expected) => {
    expect(deriveShortName(name, id)).toBe(expected);
  });

  it('returns undefined when both inputs are blank', () => {
    expect(deriveShortName()).toBeUndefined();
    expect(deriveShortName('')).toBeUndefined();
    expect(deriveShortName('  ', '  ')).toBeUndefined();
  });

  it('is deterministic across calls', () => {
    expect(deriveShortName('DeepSeek: DeepSeek V4.1 Flash 1017')).toBe(
      deriveShortName('DeepSeek: DeepSeek V4.1 Flash 1017')
    );
  });
});
