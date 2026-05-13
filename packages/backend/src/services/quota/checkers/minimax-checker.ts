import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface MiniMaxBalanceResponse {
  available_amount: string;
  base_resp: { status_code: number; status_msg: string };
}

export default defineChecker({
  type: 'minimax',
  displayName: 'MiniMax',
  optionsSchema: z.object({
    groupid: z.string().trim().min(1, 'MiniMax groupid is required'),
    hertzSession: z.string().trim().min(1, 'MiniMax HERTZ-SESSION cookie value is required'),
  }),
  async check(ctx) {
    const groupid = ctx.requireOption<string>('groupid').trim();
    const hertzSession = ctx.requireOption<string>('hertzSession').trim();

    const endpoint = `https://platform.minimax.io/account/query_balance?GroupId=${encodeURIComponent(groupid)}`;
    logger.silly(`Calling ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Cookie: `HERTZ-SESSION=${hertzSession}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: MiniMaxBalanceResponse = await response.json();
    if (data.base_resp?.status_code !== 0) {
      throw new Error(`MiniMax API error: ${data.base_resp?.status_msg || 'unknown error'}`);
    }

    const remaining = Number.parseFloat(data.available_amount);
    if (!Number.isFinite(remaining)) {
      throw new Error(`Invalid available_amount: ${data.available_amount}`);
    }

    return [
      ctx.balance({
        key: 'balance',
        label: 'Account balance',
        unit: 'usd',
        remaining,
      }),
    ];
  },
});
