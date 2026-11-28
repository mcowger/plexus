import { z } from 'zod';

import { logger } from '../../../utils/logger';
import { defineChecker } from '../checker-registry';

interface WisdomGateBalanceResponse {
  available_balance: number;
  package_balance: number;
  cash_balance: number;
  token_balance: number;
  is_token_unlimited_quota: boolean;
}

const BALANCE_ENDPOINT = 'https://api.wisgate.ai/v1/users/me/balance';

export default defineChecker({
  type: 'wisdomgate',
  displayName: 'Wisdom Gate',
  optionsSchema: z.object({
    apiKey: z.string().trim().min(1, 'Wisdom Gate API key is required'),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');

    logger.silly(`Calling ${BALANCE_ENDPOINT}`);
    const response = await fetch(BALANCE_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: WisdomGateBalanceResponse = await response.json();

    if (!Number.isFinite(data.available_balance))
      throw new Error('Invalid response: missing available_balance');

    const meters = [
      ctx.balance({
        key: 'account_balance',
        label: 'Wisdom Gate balance',
        unit: 'usd',
        remaining: data.available_balance,
      }),
    ];

    if (data.is_token_unlimited_quota === false && Number.isFinite(data.token_balance)) {
      meters.push(
        ctx.balance({
          key: 'api_key_balance',
          label: 'API key quota',
          unit: 'usd',
          remaining: data.token_balance,
        })
      );
    }

    return meters;
  },
});
