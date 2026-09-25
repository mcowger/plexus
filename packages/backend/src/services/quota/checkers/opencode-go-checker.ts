import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

const DASHBOARD_BASE_URL = 'https://opencode.ai/workspace/';
const DASHBOARD_URL_SUFFIX = '/go';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0';
const SCRAPE_TIMEOUT_MS = 10_000;

interface OpenCodeGoWindow {
  usagePercent: number;
  resetsAt?: string;
}

function parseWindowUsage(html: string, field: string, now: number): OpenCodeGoWindow | null {
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
      return { usagePercent, resetsAt: new Date(now + resetInSec * 1000).toISOString() };
    }
  }

  const resetFirstMatch = reResetFirst.exec(html);
  if (resetFirstMatch) {
    const resetInSec = Number(resetFirstMatch[1]);
    const usagePercent = Number(resetFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetsAt: new Date(now + resetInSec * 1000).toISOString() };
    }
  }

  return null;
}

function parseRelativeResetToMs(relative: string): number | null {
  // Allow leading text such as "about", but require a complete, nonempty duration.
  const m =
    /^[^\d-]*(?=\d)(?:(\d+(?:\.\d+)?)\s*d(?:ays?)?)?[\s,]*(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?[\s,]*(?:(\d+(?:\.\d+)?)\s*m(?:ins?|inutes?)?)?[\s,]*(?:(\d+(?:\.\d+)?)\s*s(?:ecs?|econds?)?)?\s*$/i.exec(
      relative.trim()
    );
  if (!m) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  const totalMs = ((days * 24 + hours) * 60 + minutes) * 60 * 1000 + seconds * 1000;
  return Number.isFinite(totalMs) && totalMs > 0 ? totalMs : null;
}

function parseCardUsage(html: string, name: string, now: number): OpenCodeGoWindow | null {
  const labelIdx = html.indexOf(`aria-label="${name} usage used"`);
  if (labelIdx < 0) return null;

  // Header metadata precedes the progressbar. The previous usage label bounds the
  // search independently of wrapper classes, so adjacent cards cannot supply it.
  const tagStart = html.lastIndexOf('<', labelIdx);
  const tagEnd = html.indexOf('>', labelIdx);
  if (tagStart < 0 || tagEnd < 0) return null;
  let cardStart = 0;
  for (const label of html
    .slice(0, tagStart)
    .matchAll(/aria-label="(?:Rolling|Weekly|Monthly) usage used"/g)) {
    cardStart = label.index + label[0].length;
  }
  const headSlice = html.slice(cardStart, tagStart);

  // Read only this progressbar's opening tag, regardless of attribute order.
  const tagSlice = html.slice(tagStart, tagEnd + 1);
  let usagePercent: number | null = null;
  const nowMatch = /aria-valuenow="(-?\d+(?:\.\d+)?)"/.exec(tagSlice);
  if (nowMatch && Number.isFinite(Number(nowMatch[1]))) {
    usagePercent = Number(nowMatch[1]);
  } else {
    // Cross-checks: aria-valuetext, then the visible badge percent.
    const textMatch = /aria-valuetext="(-?\d+(?:\.\d+)?)% used"/.exec(tagSlice);
    if (textMatch && Number.isFinite(Number(textMatch[1]))) {
      usagePercent = Number(textMatch[1]);
    } else {
      const badgeMatch = [...headSlice.matchAll(/>(\d+(?:\.\d+)?)%<\/span>\s*<\//g)].at(-1);
      if (badgeMatch && Number.isFinite(Number(badgeMatch[1]))) {
        usagePercent = Number(badgeMatch[1]);
      }
    }
  }
  if (usagePercent === null || !Number.isFinite(usagePercent)) return null;

  const resetRe = /title="([^"]+)"[^>]*>\s*Resets in\s*([^<]+)</g;
  let resetMatch: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((resetMatch = resetRe.exec(headSlice)) !== null) {
    last = resetMatch;
  }
  if (!last) return { usagePercent };
  const title = last[1]!.trim();
  // Localized or timezone-free titles would be interpreted in the server's TZ.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(title)) {
    const titleMs = Date.parse(title);
    if (Number.isFinite(titleMs)) {
      return { usagePercent, resetsAt: new Date(titleMs).toISOString() };
    }
  }
  const offsetMs = parseRelativeResetToMs(last[2] ?? '');
  if (offsetMs !== null) {
    return { usagePercent, resetsAt: new Date(now + offsetMs).toISOString() };
  }
  return { usagePercent };
}

export default defineChecker({
  type: 'opencode-go',
  displayName: 'OpenCode Go',
  meterOrder: ['rolling_5h', 'weekly', 'monthly'],
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

    const now = Date.now();
    const rollingCard = parseCardUsage(html, 'Rolling', now);
    const weeklyCard = parseCardUsage(html, 'Weekly', now);
    const monthlyCard = parseCardUsage(html, 'Monthly', now);

    let rolling = rollingCard;
    let weekly = weeklyCard;
    let monthly = monthlyCard;
    if (!rolling && !weekly && !monthly) {
      // Fallback for the older React-flight dashboard markup.
      rolling = parseWindowUsage(html, 'rollingUsage', now);
      weekly = parseWindowUsage(html, 'weeklyUsage', now);
      monthly = parseWindowUsage(html, 'monthlyUsage', now);
    }

    if (!rolling && !weekly && !monthly) {
      throw new Error(
        'Could not parse any OpenCode Go dashboard usage windows (usage cards or rollingUsage, weeklyUsage, monthlyUsage flight data)'
      );
    }

    const meters = [];

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
          ...(rolling.resetsAt ? { resetsAt: rolling.resetsAt } : {}),
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
          ...(weekly.resetsAt ? { resetsAt: weekly.resetsAt } : {}),
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
          ...(monthly.resetsAt ? { resetsAt: monthly.resetsAt } : {}),
        })
      );
    }

    logger.debug(`Returning ${meters.length} OpenCode Go meter(s)`);
    return meters;
  },
});
