import { defineChecker } from '../checker-registry';
import { z } from 'zod';

interface RoutingRunRequestsResponse {
  requests_used_today: number;
  requests_limit_today: number;
  requests_remaining: number;
  requests_used_this_hour: number;
  requests_limit_this_hour: number;
  requests_remaining_this_hour: number;
  requests_used_this_minute: number;
  requests_limit_per_minute: number;
  requests_remaining_this_minute: number;
  plan_tier?: string;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${field} received: ${String(value)}`);
  }
  return value;
}

export default defineChecker({
  type: 'routing-run',
  displayName: 'Routing.run',
  optionsSchema: z.object({
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.routing.run/v1/user/requests');

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    const data = (await response.json()) as Partial<RoutingRunRequestsResponse>;
    const nowMs = Date.now();

    const requestsUsedToday = requireNumber(data.requests_used_today, 'requests_used_today');
    const requestsLimitToday = requireNumber(data.requests_limit_today, 'requests_limit_today');
    const requestsRemaining = requireNumber(data.requests_remaining, 'requests_remaining');

    const requestsUsedThisHour = requireNumber(
      data.requests_used_this_hour,
      'requests_used_this_hour'
    );
    const requestsLimitThisHour = requireNumber(
      data.requests_limit_this_hour,
      'requests_limit_this_hour'
    );
    const requestsRemainingThisHour = requireNumber(
      data.requests_remaining_this_hour,
      'requests_remaining_this_hour'
    );

    const requestsUsedThisMinute = requireNumber(
      data.requests_used_this_minute,
      'requests_used_this_minute'
    );
    const requestsLimitPerMinute = requireNumber(
      data.requests_limit_per_minute,
      'requests_limit_per_minute'
    );
    const requestsRemainingThisMinute = requireNumber(
      data.requests_remaining_this_minute,
      'requests_remaining_this_minute'
    );

    const meters = [
      ctx.allowance({
        key: 'daily',
        label: 'Daily request quota',
        unit: 'requests',
        limit: requestsLimitToday,
        used: requestsUsedToday,
        remaining: requestsRemaining,
        periodValue: 1,
        periodUnit: 'day',
        periodCycle: 'fixed',
        resetsAt: new Date(
          Date.UTC(
            new Date(nowMs).getUTCFullYear(),
            new Date(nowMs).getUTCMonth(),
            new Date(nowMs).getUTCDate() + 1
          )
        ).toISOString(),
      }),
    ];

    if (requestsLimitThisHour > 0) {
      meters.push(
        ctx.allowance({
          key: 'hourly',
          label: 'Hourly request quota',
          unit: 'requests',
          limit: requestsLimitThisHour,
          used: requestsUsedThisHour,
          remaining: requestsRemainingThisHour,
          periodValue: 1,
          periodUnit: 'hour',
          periodCycle: 'fixed',
          resetsAt: new Date(Math.floor(nowMs / 3_600_000) * 3_600_000 + 3_600_000).toISOString(),
        })
      );
    }

    meters.push(
      ctx.allowance({
        key: 'minute',
        label: 'Per-minute request limit',
        unit: 'requests',
        limit: requestsLimitPerMinute,
        used: requestsUsedThisMinute,
        remaining: requestsRemainingThisMinute,
        periodValue: 1,
        periodUnit: 'minute',
        periodCycle: 'rolling',
        resetsAt: new Date(nowMs + 60_000).toISOString(),
      })
    );

    return meters;
  },
});
