import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

const DASHBOARD_BASE_URL = 'https://opencode.ai/workspace/';
const DASHBOARD_URL_SUFFIX = '/go';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0';
const SCRAPE_TIMEOUT_MS = 10_000;

interface OpenCodeGoWindow {
  usagePercent: number;
  resetInSec: number;
}

function parseWindowUsage(html: string, field: string): OpenCodeGoWindow | null {
  const rePctFirst = new RegExp(
    `${field}:\\$R\\[\\d+\\]=\\{[^}]*usagePercent:(-?\\d+(?:\\.\\d+)?)[^}]*resetInSec:(-?\\d+(?:\\.\\d+)?)[^}]*\\}`
  );
  const reResetFirst = new RegExp(
    `${field}:\\$R\\[\\d+\\]=\\{[^}]*resetInSec:(-?\\d+(?:\\.\\d+)?)[^}]*usagePercent:(-?\\d+(?:\\.\\d+)?)[^}]*\\}`
  );

  const pctFirstMatch = rePctFirst.exec(html);
  if (pctFirstMatch) {
    const usagePercent = Number(pctFirstMatch[1]);
    const resetInSec = Number(pctFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  const resetFirstMatch = reResetFirst.exec(html);
  if (resetFirstMatch) {
    const resetInSec = Number(resetFirstMatch[1]);
    const usagePercent = Number(resetFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  return null;
}

export default defineChecker({
  type: 'opencode-go',
  optionsSchema: z.object({
    workspaceId: z.string().min(1, 'OpenCode Go workspace ID is required'),
    authCookie: z.string().min(1, 'OpenCode Go auth cookie is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const workspaceId = ctx.getOption<string>('workspaceId', '').trim();
    const authCookie = ctx.getOption<string>('authCookie', '').trim();
    if (!workspaceId || !authCookie) {
      const missing = [!workspaceId && 'workspaceId', !authCookie && 'authCookie']
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `OpenCode Go requires ${missing} in quota_checker.options. ` +
          'Set these in the provider config (e.g. options: { workspaceId: "...", authCookie: "..." })'
      );
    }
    const configuredEndpoint = ctx.getOption<string>('endpoint', '');
    const endpoint =
      configuredEndpoint ||
      `${DASHBOARD_BASE_URL}${encodeURIComponent(workspaceId)}${DASHBOARD_URL_SUFFIX}`;

    logger.silly(`Fetching OpenCode Go dashboard: ${endpoint}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

    let html: string;
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
          Cookie: `auth=${authCookie}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenCode Go dashboard error ${response.status}: ${response.statusText}`);
      }

      html = await response.text();
    } finally {
      clearTimeout(timeout);
    }

    const rolling = parseWindowUsage(html, 'rollingUsage');
    const weekly = parseWindowUsage(html, 'weeklyUsage');
    const monthly = parseWindowUsage(html, 'monthlyUsage');

    if (!rolling && !weekly && !monthly) {
      throw new Error(
        'Could not parse any OpenCode Go dashboard usage windows (rollingUsage, weeklyUsage, monthlyUsage)'
      );
    }

    const meters = [];
    const now = Date.now();

    if (rolling) {
      meters.push(
        ctx.allowance({
          key: 'rolling_5h',
          label: 'Rolling 5h quota',
          unit: 'percentage',
          used: rolling.usagePercent,
          remaining: Math.max(0, 100 - rolling.usagePercent),
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: new Date(now + rolling.resetInSec * 1000).toISOString(),
        })
      );
    }

    if (weekly) {
      meters.push(
        ctx.allowance({
          key: 'weekly',
          label: 'Weekly quota',
          unit: 'percentage',
          used: weekly.usagePercent,
          remaining: Math.max(0, 100 - weekly.usagePercent),
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: new Date(now + weekly.resetInSec * 1000).toISOString(),
        })
      );
    }

    if (monthly) {
      meters.push(
        ctx.allowance({
          key: 'monthly',
          label: 'Monthly quota',
          unit: 'percentage',
          used: monthly.usagePercent,
          remaining: Math.max(0, 100 - monthly.usagePercent),
          periodValue: 1,
          periodUnit: 'month',
          periodCycle: 'rolling',
          resetsAt: new Date(now + monthly.resetInSec * 1000).toISOString(),
        })
      );
    }

    logger.debug(`Returning ${meters.length} OpenCode Go meter(s)`);
    return meters;
  },
});
