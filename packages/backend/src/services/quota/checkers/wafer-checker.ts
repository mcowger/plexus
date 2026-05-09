import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface WaferQuotaResponse {
  window_start: string;
  window_end: string;
  included_request_limit: number;
  included_request_count: number;
  remaining_included_requests: number;
  current_period_used_percent: number;
}

export default defineChecker({
  type: 'wafer',
  optionsSchema: z.object({
    endpoint: z.string().optional(),
    apiKey: z.string().min(1, 'Wafer API key is required'),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://pass.wafer.ai/v1/inference/quota');
    logger.silly(`[wafer] Calling ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: WaferQuotaResponse = await response.json();

    const {
      included_request_limit,
      included_request_count,
      remaining_included_requests,
      window_end,
    } = data;

    const resetsAt = new Date(window_end);
    if (isNaN(resetsAt.getTime())) {
      throw new Error(`Invalid window_end date received: ${window_end}`);
    }

    const limit = Number(included_request_limit);
    if (!Number.isFinite(limit) || limit < 0) {
      throw new Error(`Invalid included_request_limit received: ${String(included_request_limit)}`);
    }
    const used = Number(included_request_count);
    if (!Number.isFinite(used) || used < 0) {
      throw new Error(`Invalid included_request_count received: ${String(included_request_count)}`);
    }
    const remaining = Number(remaining_included_requests);
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new Error(
        `Invalid remaining_included_requests received: ${String(remaining_included_requests)}`
      );
    }

    const meters = [
      ctx.allowance({
        key: 'wafer_5h',
        label: '5-hour request quota',
        unit: 'requests',
        limit,
        used,
        remaining,
        periodValue: 5,
        periodUnit: 'hour',
        periodCycle: 'fixed',
        resetsAt: resetsAt.toISOString(),
      }),
    ];

    logger.silly(`Returning ${meters.length} meters`);
    return meters;
  },
});
