import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import type { OAuthProvider } from '../../oauth/oauth-providers';
import { logger } from '../../../utils/logger';

const ClaudeUsageWindowSchema = z.object({
  utilization: z.number(),
  resets_at: z.string().nullish(),
});

const ClaudeScopeLabelSchema = z
  .object({ id: z.string().nullish(), display_name: z.string().nullish() })
  .nullish();

const ClaudeLimitSchema = z.object({
  kind: z.string(),
  percent: z.number().nullish(),
  resets_at: z.string().nullish(),
  scope: z.object({ model: ClaudeScopeLabelSchema, surface: ClaudeScopeLabelSchema }).nullish(),
});

const ClaudeUsageResponseSchema = z.object({
  five_hour: ClaudeUsageWindowSchema.nullish(),
  seven_day: ClaudeUsageWindowSchema.nullish(),
  seven_day_opus: ClaudeUsageWindowSchema.nullish(),
  seven_day_omelette: ClaudeUsageWindowSchema.nullish(),
  limits: z.array(z.unknown()).nullish(),
});

type ClaudeLimit = z.infer<typeof ClaudeLimitSchema>;
type ClaudeUsageResponse = z.infer<typeof ClaudeUsageResponseSchema>;

const SCOPED_WEEKLY_KIND = 'weekly_scoped';
const CLAUDE_OAUTH_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

interface ScopedLimit {
  dimension: 'model' | 'surface';
  id: string | null;
  name: string;
  usedPct: number | null;
  resetsAt: string | null;
}

const LEGACY_SCOPED_WINDOWS: ReadonlyArray<{
  field: 'seven_day_opus' | 'seven_day_omelette';
  name: string;
}> = [
  { field: 'seven_day_opus', name: 'Opus' },
  { field: 'seven_day_omelette', name: 'Omelette' },
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isSameLimit(a: ScopedLimit, b: ScopedLimit): boolean {
  if (a.dimension !== b.dimension) return false;
  if (a.id && b.id) return a.id === b.id;
  return normalizeName(a.name) === normalizeName(b.name);
}

function reconcileScopedLimits(
  legacy: ScopedLimit[],
  fromLimitsArray: ScopedLimit[]
): ScopedLimit[] {
  const reconciled = [...legacy];
  for (const limit of fromLimitsArray) {
    const index = reconciled.findIndex((candidate) => isSameLimit(candidate, limit));
    if (index === -1) {
      reconciled.push(limit);
      continue;
    }
    const twin = reconciled[index];
    reconciled[index] = {
      ...limit,
      usedPct: limit.usedPct ?? twin?.usedPct ?? null,
      resetsAt: limit.resetsAt ?? twin?.resetsAt ?? null,
    };
  }
  return reconciled;
}

function scopedLimitFromLegacy(
  spec: (typeof LEGACY_SCOPED_WINDOWS)[number],
  window: z.infer<typeof ClaudeUsageWindowSchema>
): ScopedLimit {
  return {
    dimension: 'model',
    id: null,
    name: spec.name,
    usedPct: window.utilization,
    resetsAt: window.resets_at ?? null,
  };
}

function scopedLimitFromEntry(limit: ClaudeLimit): ScopedLimit | null {
  for (const dimension of ['model', 'surface'] as const) {
    const entry = limit.scope?.[dimension];
    const id = entry?.id?.trim() || null;
    const name = entry?.display_name?.trim() || id;
    if (name) {
      return {
        dimension,
        id,
        name,
        usedPct: limit.percent ?? null,
        resetsAt: limit.resets_at ?? null,
      };
    }
  }
  return null;
}

function scopedWindowKey(limit: ScopedLimit): string {
  return `weekly_${limit.dimension}_${limit.id ?? normalizeName(limit.name)}`;
}

function uniqueWindowKey(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  for (let suffix = 2; ; suffix += 1) {
    const next = `${candidate}_${suffix}`;
    if (!taken.has(next)) return next;
  }
}

function legacyScopedLimits(resp: ClaudeUsageResponse): ScopedLimit[] {
  const limits: ScopedLimit[] = [];
  for (const spec of LEGACY_SCOPED_WINDOWS) {
    const window = resp[spec.field];
    if (window) limits.push(scopedLimitFromLegacy(spec, window));
  }
  return limits;
}

function scopedLimitsFromResponse(limits: unknown[] | null | undefined): ScopedLimit[] {
  if (!limits || !Array.isArray(limits)) return [];

  const parsed: ScopedLimit[] = [];
  for (const entry of limits) {
    const result = ClaudeLimitSchema.safeParse(entry);
    if (!result.success) {
      logger.warn(`Skipping unparseable Claude usage limit entry: ${result.error}`);
      continue;
    }
    if (result.data.kind !== SCOPED_WEEKLY_KIND) continue;

    const limit = scopedLimitFromEntry(result.data);
    if (!limit) {
      logger.warn('Skipping scoped Claude usage limit with no resolvable scope name');
      continue;
    }
    parsed.push(limit);
  }
  return parsed;
}

function parseIsoDate(dateStr: string | null | undefined): string | undefined {
  if (!dateStr) return undefined;
  try {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

async function resolveApiKey(ctx: {
  getOption<T>(key: string, def: T): T;
  checkerId: string;
}): Promise<string> {
  const configured = ctx.getOption<string>('apiKey', '').trim();
  if (configured) return configured;

  const provider = ctx.getOption<string>('oauthProvider', 'anthropic').trim() || 'anthropic';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();
  const refreshOptions =
    provider === 'anthropic'
      ? { refreshIfOlderThanMs: CLAUDE_OAUTH_REFRESH_INTERVAL_MS }
      : undefined;

  try {
    return oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId, refreshOptions)
      : await authManager.getApiKey(provider as OAuthProvider, undefined, refreshOptions);
  } catch {
    await authManager.reload();
    logger.info(`Reloaded OAuth auth file and retrying for '${provider}'`);
    return oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId, refreshOptions)
      : await authManager.getApiKey(provider as OAuthProvider, undefined, refreshOptions);
  }
}

export default defineChecker({
  type: 'claude-code',
  displayName: 'Claude Code',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = await resolveApiKey(ctx);
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.anthropic.com/api/oauth/usage');

    logger.silly(`Fetching usage from ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const rawData = await response.json();
    logger.silly(`Usage: ${JSON.stringify(rawData)}`);

    const parseResult = ClaudeUsageResponseSchema.safeParse(rawData);
    if (!parseResult.success) {
      logger.warn(`Failed to parse Claude usage response: ${parseResult.error}`);
      return [];
    }
    const usage = parseResult.data;

    const meters = [];

    if (usage.five_hour) {
      meters.push(
        ctx.allowance({
          key: 'five_hour',
          label: '5-hour quota',
          unit: 'percentage',
          used: usage.five_hour.utilization,
          remaining: Math.max(0, 100 - usage.five_hour.utilization),
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: parseIsoDate(usage.five_hour.resets_at),
        })
      );
    }

    if (usage.seven_day) {
      meters.push(
        ctx.allowance({
          key: 'weekly',
          label: 'Weekly quota',
          unit: 'percentage',
          used: usage.seven_day.utilization,
          remaining: Math.max(0, 100 - usage.seven_day.utilization),
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: parseIsoDate(usage.seven_day.resets_at),
        })
      );
    }

    const scoped = reconcileScopedLimits(
      legacyScopedLimits(usage),
      scopedLimitsFromResponse(usage.limits)
    );

    const takenKeys = new Set<string>();
    for (const limit of scoped) {
      const key = uniqueWindowKey(scopedWindowKey(limit), takenKeys);
      takenKeys.add(key);

      const used = limit.usedPct ?? 0;
      meters.push(
        ctx.allowance({
          key,
          label: `Weekly · ${limit.name}`,
          unit: 'percentage',
          used,
          remaining: limit.usedPct != null ? Math.max(0, 100 - limit.usedPct) : 100,
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: parseIsoDate(limit.resetsAt),
          scope: limit.dimension,
        })
      );
    }

    if (meters.length === 0) {
      logger.warn('Claude usage response parsed but produced no meters');
    }

    logger.silly(`Returning ${meters.length} meters`);
    return meters;
  },
});
