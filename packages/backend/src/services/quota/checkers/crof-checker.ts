import { defineChecker } from '../checker-registry';
import { z } from 'zod';

interface CrofUsageResponse {
  credits: number;
  requests_plan: number;
  usable_requests: number;
}

export default defineChecker({
  type: 'crof',
  displayName: 'Crof',
  optionsSchema: z.object({
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://crof.ai/usage_api/');

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`
      );
    }

    const data: CrofUsageResponse = await response.json();

    if (
      typeof data.credits !== 'number' ||
      typeof data.requests_plan !== 'number' ||
      typeof data.usable_requests !== 'number'
    ) {
      throw new Error('Crof API returned an unexpected response shape');
    }

    const meters = [];

    const usedRequests = data.requests_plan - data.usable_requests;
    meters.push(
      ctx.allowance({
        key: 'daily_requests',
        label: 'Daily requests',
        unit: 'requests',
        limit: data.requests_plan,
        used: usedRequests,
        remaining: data.usable_requests,
        periodValue: 1,
        periodUnit: 'day',
        periodCycle: 'rolling',
      })
    );

    meters.push(
      ctx.balance({
        key: 'credits',
        label: 'Credits',
        unit: 'credits',
        remaining: data.credits,
      })
    );

    return meters;
  },
});
