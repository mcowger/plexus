import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface MoonshotBalanceResponse {
  code: number;
  data: {
    available_balance: number;
    voucher_balance: number;
    cash_balance: number;
  };
  scode: string;
  status: boolean;
}

export default defineChecker({
  type: 'moonshot',
  displayName: 'Moonshot',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Moonshot API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://api.moonshot.ai/v1/users/me/balance'
    );

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: MoonshotBalanceResponse = await response.json();
    if (!data.status || data.code !== 0) {
      throw new Error(`Moonshot API error: code=${data.code}, scode=${data.scode}`);
    }

    const { cash_balance, voucher_balance } = data.data;
    const meters = [];

    meters.push(
      ctx.balance({
        key: 'cash',
        label: 'Cash balance',
        scope: 'cash',
        unit: 'usd',
        remaining: cash_balance,
      })
    );

    if (voucher_balance > 0) {
      meters.push(
        ctx.balance({
          key: 'voucher',
          label: 'Voucher balance',
          scope: 'voucher',
          unit: 'usd',
          remaining: voucher_balance,
        })
      );
    }

    return meters;
  },
});
