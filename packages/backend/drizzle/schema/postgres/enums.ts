import { pgEnum } from 'drizzle-orm/pg-core';

// oauth_provider_type is intentionally a free-text column (see
// schema/postgres/providers.ts and oauth-credentials.ts), not a pgEnum:
// its valid values are provider ids from pi-ai's OAuth registry (see
// services/oauth/oauth-providers.ts), which Plexus doesn't control the
// membership of and validates dynamically at the application layer. A
// Postgres enum would require a migration every time pi-ai adds/removes an
// OAuth provider, which defeats the point of validating it dynamically.

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
  'routing-run',
  'gemini-cli',
  'antigravity',
  'novita',
  'ollama',
  'neuralwatt',
  'zenmux',
  'devpass',
  'wafer',
  'opencode-go',
  'crof',
  'exedev',
  'hyper',
  'sakana',
  'cline',
]);
