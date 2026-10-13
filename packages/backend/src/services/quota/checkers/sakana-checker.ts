import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

interface UsageWindow {
  percent: number;
  resetsAt?: string;
}

function extractUsageWindow(html: string, label: string): UsageWindow | null {
  const percentRe = new RegExp(`aria-label="${label}:\\s*([\\d.]+)% used"`);
  const percentMatch = html.match(percentRe);
  if (!percentMatch) {
    logger.debug(`Could not find ${label} usage percent in HTML`);
    return null;
  }
  const percent = parseFloat(percentMatch[1]!);

  const resetRe = new RegExp(`>${label}</p>\\s*<p[^>]*>Resets on ([^<]+)<`);
  const resetMatch = html.match(resetRe);
  let resetsAt: string | undefined;
  if (resetMatch) {
    const dateStr = resetMatch[1]!.trim();
    const normalized = dateStr.replace(' at ', ' ') + ' UTC';
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      resetsAt = date.toISOString();
    }
  }

  logger.silly(`${label}: ${percent}% used, resets at ${resetsAt ?? 'unknown'}`);
  return { percent, resetsAt };
}

function extractCreditBalance(html: string): number | null {
  const match = html.match(/Credit balance[\s\S]*?\$\$(\d[\d,.]*)/);
  if (!match) return null;
  const amount = parseFloat(match[1]!.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return amount;
}

export default defineChecker({
  type: 'sakana',
  displayName: 'Sakana',
  optionsSchema: z.object({
    sessionCookie: z.string().trim().min(1, 'Sakana session cookie is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const sessionCookie = ctx.requireOption<string>('sessionCookie');
    const endpoint = ctx.getOption<string>('endpoint', 'https://console.sakana.ai/billing');

    logger.debug(`Fetching ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: `__Secure-authjs.session-token=${sessionCookie}`,
      },
    });

    if (response.url.includes('/login')) {
      throw new Error('Authentication failed. The session cookie may be expired or invalid.');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const meters = [];

    const fiveHour = extractUsageWindow(html, '5-hour');
    if (fiveHour) {
      meters.push(
        ctx.allowance({
          key: 'five_hour',
          label: '5-hour',
          unit: 'percentage',
          used: fiveHour.percent,
          remaining: Math.max(0, 100 - fiveHour.percent),
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: fiveHour.resetsAt,
        })
      );
    }

    const weekly = extractUsageWindow(html, 'Weekly');
    if (weekly) {
      meters.push(
        ctx.allowance({
          key: 'weekly',
          label: 'Weekly',
          unit: 'percentage',
          used: weekly.percent,
          remaining: Math.max(0, 100 - weekly.percent),
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: weekly.resetsAt,
        })
      );
    }

    const credit = extractCreditBalance(html);
    if (credit !== null) {
      meters.push(
        ctx.balance({
          key: 'credit',
          label: 'Credit balance',
          unit: 'usd',
          remaining: credit,
        })
      );
    }

    if (meters.length === 0) throw new Error('Could not parse usage data from Sakana billing page');

    return meters;
  },
});
