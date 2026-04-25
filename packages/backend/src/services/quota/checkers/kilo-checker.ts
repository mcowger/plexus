import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface KiloBalanceResponse {
  balance?: number;
}

export default defineChecker({
  type: 'kilo',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Kilo API key is required'),
    endpoint: z.string().url().optional(),
    organizationId: z.string().trim().min(1).optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.kilo.ai/api/profile/balance');
    const organizationId = ctx.getOption<string | undefined>('organizationId', undefined)?.trim() || undefined;

    logger.silly(`[kilo] Calling ${endpoint}`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (organizationId) headers['x-kilocode-organizationid'] = organizationId;

    const response = await fetch(endpoint, { method: 'GET', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: KiloBalanceResponse = await response.json();
    const remaining = Number(data.balance);
    if (!Number.isFinite(remaining)) throw new Error(`Invalid balance: ${String(data.balance)}`);

    return [ctx.balance({ key: 'balance', label: 'Account balance', unit: 'usd', remaining })];
  },
});
