import { pgEnum } from 'drizzle-orm/pg-core';

export const oauthProviderTypeEnum = pgEnum('oauth_provider_type', [
  'anthropic',
  'openai-codex',
  'github-copilot',
  'google-gemini-cli',
  'google-antigravity',
]);

export const quotaCheckerTypeEnum = pgEnum('quota_checker_type', [
  'naga',
  'synthetic',
  'nanogpt',
  'zai',
  'moonshot',
  'minimax',
  'minimax-coding',
  'openrouter',
  'kilo',
  'openai-codex',
  'claude-code',
  'kimi-code',
  'copilot',
  'wisdomgate',
  'apertis',
  'apertis-coding-plan',
  'poe',
  'gemini-cli',
  'antigravity',
]);
