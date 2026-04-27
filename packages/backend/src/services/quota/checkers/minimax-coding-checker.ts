import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface MiniMaxCodingModelRemain {
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  model_name: string;
}

interface MiniMaxCodingResponse {
  model_remains: MiniMaxCodingModelRemain[];
  base_resp: { status_code: number; status_msg: string };
}

export default defineChecker({
  type: 'minimax-coding',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'MiniMax Coding API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://www.minimax.io/v1/api/openplatform/coding_plan/remains'
    );

    logger.debug(`[minimax-coding] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: MiniMaxCodingResponse = await response.json();
    if (data.base_resp?.status_code !== 0) {
      throw new Error(`MiniMax API error: ${data.base_resp?.status_msg || 'unknown error'}`);
    }

    const firstModel = data.model_remains[0];
    if (!firstModel) return [];

    const limit = firstModel.current_interval_total_count;
    // API field is misleading: "usage_count" is actually REMAINING, not used
    const remaining = firstModel.current_interval_usage_count;
    const used = limit - remaining;
    const resetsAt = new Date(firstModel.end_time).toISOString();

    return [
      ctx.allowance({
        key: 'coding_plan',
        label: 'Coding plan',
        unit: 'requests',
        limit,
        used,
        remaining,
        periodValue: 1,
        periodUnit: 'month',
        periodCycle: 'fixed',
        resetsAt,
      }),
    ];
  },
});
