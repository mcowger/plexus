import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

function extractUsage(html: string, label: string): { percent: number; resetsAt?: string } | null {
  // Primary: use aria-label (e.g. 'Session usage 4.4% used') — most robust against HTML changes
  const ariaPattern = new RegExp(`aria-label="${label} ([\\d.]+)% used"`);
  const ariaMatch = html.match(ariaPattern);
  if (ariaMatch) {
    const percent = parseFloat(ariaMatch[1]!);
    // data-time is on a sibling element after the usage meter, search the broader area
    const labelIndex = html.indexOf(label);
    const resetMatch = labelIndex !== -1 ? html.slice(labelIndex, labelIndex + 3000).match(/data-time="([^"]+)"/) : null;
    const resetsAt = resetMatch ? new Date(resetMatch[1]!).toISOString() : undefined;

    logger.silly(`${label}: ${percent}% (aria-label), resets at ${resetsAt}`);
    return { percent, resetsAt };
  }

  // Fallback: find label text, then look for style="width: X%" in a wider window
  const labelIndex = html.indexOf(label);
  if (labelIndex === -1) {
    logger.debug(`Label "${label}" not found in HTML`);
    return null;
  }

  const snippet = html.slice(labelIndex, labelIndex + 2000);
  const percentMatch = snippet.match(/style="width:\s*([\d.]+)%/);
  if (!percentMatch) {
    logger.debug(`Could not extract usage percent for ${label}`);
    return null;
  }

  const percent = parseFloat(percentMatch[1]!);
  const resetMatch = snippet.match(/data-time="([^"]+)"/);
  const resetsAt = resetMatch ? new Date(resetMatch[1]!).toISOString() : undefined;

  logger.silly(`${label}: ${percent}% (style), resets at ${resetsAt}`);
  return { percent, resetsAt };
}

export default defineChecker({
  type: 'ollama',
  displayName: 'Ollama',
  optionsSchema: z.object({
    sessionCookie: z.string().min(1, 'Ollama session cookie is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const sessionCookie = ctx.requireOption<string>('sessionCookie');
    const endpoint = ctx.getOption<string>('endpoint', 'https://ollama.com/settings');

    logger.debug(`Fetching ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: `__Secure-session=${sessionCookie}`,
      },
    });

    if (!response.ok) {
      if (response.status === 303 || response.url.includes('/signin')) {
        throw new Error('Authentication failed. The session cookie may be expired or invalid.');
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const meters = [];

    const sessionUsage = extractUsage(html, 'Session usage');
    if (sessionUsage) {
      meters.push(
        ctx.allowance({
          key: 'session',
          label: 'Session usage',
          unit: 'percentage',
          used: sessionUsage.percent,
          remaining: 100 - sessionUsage.percent,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: sessionUsage.resetsAt,
        })
      );
    }

    const weeklyUsage = extractUsage(html, 'Weekly usage');
    if (weeklyUsage) {
      meters.push(
        ctx.allowance({
          key: 'weekly',
          label: 'Weekly usage',
          unit: 'percentage',
          used: weeklyUsage.percent,
          remaining: 100 - weeklyUsage.percent,
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: weeklyUsage.resetsAt,
        })
      );
    }

    if (meters.length === 0)
      throw new Error('Could not parse usage data from Ollama settings page');

    return meters;
  },
});
