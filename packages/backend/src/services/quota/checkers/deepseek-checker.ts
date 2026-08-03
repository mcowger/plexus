import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
}

export default defineChecker({
  type: 'deepseek',
  displayName: 'DeepSeek',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'DeepSeek API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.deepseek.com/user/balance');

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`
      );
    }

    const data: DeepSeekBalanceResponse = await response.json();

    if (!Array.isArray(data.balance_infos)) {
      throw new Error('Unexpected response: missing balance_infos array');
    }

    const meters = data.balance_infos.map((info) => {
      const remaining = Number(info.total_balance);
      if (!Number.isFinite(remaining)) {
        throw new Error(`Invalid balance for ${info.currency}: ${String(info.total_balance)}`);
      }

      // If the account is not available, treat balance as zero
      const effectiveRemaining = data.is_available ? remaining : 0;

      return ctx.balance({
        key: `${info.currency.toLowerCase()}_balance`,
        label: `${info.currency} account balance`,
        unit: info.currency,
        remaining: effectiveRemaining,
      });
    });

    if (meters.length === 0) {
      throw new Error('No balance_infos entries in response');
    }

    return meters;
  },
});
