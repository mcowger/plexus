import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface ExeDevCreditsResponse {
  monthly_allowance_usd: number;
  monthly_credits_left_usd: number;
  extra_credits_left_usd: number;
  next_credit_reset: string;
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseResetTimestamp(input: string): string {
  const [time, datePart] = input.split(' on ');
  if (!time || !datePart) throw new Error(`Cannot parse next_credit_reset: "${input}"`);

  const [hours, minutes] = time.split(':').map(Number);
  const parts = datePart.trim().split(/\s+/);
  if (parts.length < 2) throw new Error(`Cannot parse next_credit_reset: "${input}"`);
  const [monthName, dayStr] = parts;
  if (!monthName || !dayStr) throw new Error(`Cannot parse next_credit_reset: "${input}"`);
  const monthIdx = MONTHS[monthName];
  const day = parseInt(dayStr, 10);
  if (monthIdx === undefined || isNaN(day) || isNaN(hours!) || isNaN(minutes!))
    throw new Error(`Cannot parse next_credit_reset: "${input}"`);

  const year = new Date().getUTCFullYear();
  let ts = Date.UTC(year, monthIdx, day, hours, minutes);
  if (ts < Date.now()) ts = Date.UTC(year + 1, monthIdx, day, hours, minutes);
  return new Date(ts).toISOString();
}

export default defineChecker({
  type: 'exedev',
  displayName: 'exe.dev',
  optionsSchema: z.object({
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://exe.dev/exec');

    logger.silly(`[exedev] Calling ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'text/plain',
      },
      body: 'billing credits --json',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`
      );
    }

    const data: ExeDevCreditsResponse = await response.json();

    const limit = Number(data.monthly_allowance_usd);
    const remaining = Number(data.monthly_credits_left_usd);
    const used = limit - remaining;
    const extraCredits = Number(data.extra_credits_left_usd);

    if (!Number.isFinite(limit) || limit < 0)
      throw new Error(`Invalid monthly_allowance_usd: ${String(data.monthly_allowance_usd)}`);
    if (!Number.isFinite(remaining) || remaining < 0)
      throw new Error(`Invalid monthly_credits_left_usd: ${String(data.monthly_credits_left_usd)}`);
    if (!Number.isFinite(extraCredits) || extraCredits < 0)
      throw new Error(`Invalid extra_credits_left_usd: ${String(data.extra_credits_left_usd)}`);

    const resetsAt = data.next_credit_reset
      ? parseResetTimestamp(data.next_credit_reset)
      : undefined;

    return [
      ctx.allowance({
        key: 'shelley_allowance',
        label: 'Monthly allowance',
        unit: 'usd',
        limit,
        used,
        remaining,
        periodValue: 1,
        periodUnit: 'month',
        periodCycle: 'fixed',
        resetsAt,
      }),
      ctx.balance({
        key: 'shelley_extra_credits',
        label: 'Extra credits',
        unit: 'usd',
        remaining: extraCredits,
      }),
    ];
  },
});
