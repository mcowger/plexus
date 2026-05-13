import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface ZenmuxQuotaResponse {
  success: boolean;
  data: {
    plan: {
      tier: string;
      amount_usd: number;
      interval: string;
      expires_at: string;
    };
    currency: string;
    base_usd_per_flow: number;
    effective_usd_per_flow: number;
    account_status: string;
    quota_5_hour: {
      usage_percentage: number;
      resets_at: string;
      max_flows: number;
      used_flows: number;
      remaining_flows: number;
      used_value_usd: number;
      max_value_usd: number;
    };
    quota_7_day: {
      usage_percentage: number;
      resets_at: string;
      max_flows: number;
      used_flows: number;
      remaining_flows: number;
      used_value_usd: number;
      max_value_usd: number;
    };
    quota_monthly: {
      max_flows: number;
      max_value_usd: number;
    };
  };
}

export default defineChecker({
  type: 'zenmux',
  displayName: 'Zenmux',
  optionsSchema: z.object({
    managementApiKey: z.string().min(1, 'Zenmux management API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const managementApiKey = ctx.requireOption<string>('managementApiKey');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://zenmux.ai/api/v1/management/subscription/detail'
    );

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${managementApiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: ZenmuxQuotaResponse = await response.json();

    if (!data.success || !data.data) throw new Error('Zenmux API returned unsuccessful response');

    const { quota_5_hour, quota_7_day } = data.data;
    const meters = [];

    meters.push(
      ctx.allowance({
        key: 'quota_5h',
        label: '5-hour quota',
        unit: 'flows',
        limit: quota_5_hour.max_flows,
        used: quota_5_hour.used_flows,
        remaining: quota_5_hour.remaining_flows,
        periodValue: 5,
        periodUnit: 'hour',
        periodCycle: 'rolling',
        resetsAt: new Date(quota_5_hour.resets_at).toISOString(),
      })
    );

    meters.push(
      ctx.allowance({
        key: 'quota_7d',
        label: '7-day quota',
        unit: 'flows',
        limit: quota_7_day.max_flows,
        used: quota_7_day.used_flows,
        remaining: quota_7_day.remaining_flows,
        periodValue: 7,
        periodUnit: 'day',
        periodCycle: 'rolling',
        resetsAt: new Date(quota_7_day.resets_at).toISOString(),
      })
    );

    logger.silly(`Returning ${meters.length} meters`);
    return meters;
  },
});
