import { defineChecker } from '../checker-registry';
import { z } from 'zod';

interface NagaBalanceResponse {
  balance: string;
}

export default defineChecker({
  type: 'naga',
  displayName: 'Naga',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Naga provisioning key is required'),
    max: z.number().positive().optional(),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.naga.ac/v1/account/balance');

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: NagaBalanceResponse = await response.json();
    const remaining = parseFloat(data.balance);
    if (isNaN(remaining)) throw new Error(`Invalid balance value: ${data.balance}`);

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
