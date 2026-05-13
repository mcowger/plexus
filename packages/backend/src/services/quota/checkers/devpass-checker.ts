import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface DevPassUsageResponse {
  hasPersonalOrg?: boolean;
  devPlan?: string;
  devPlanCycle?: string;
  devPlanCreditsUsed?: string | number;
  devPlanCreditsLimit?: string | number;
  devPlanCreditsRemaining?: string | number;
  devPlanBillingCycleStart?: string;
  devPlanCancelled?: boolean;
  devPlanExpiresAt?: string | null;
  regularCredits?: string;
  organizationId?: string;
  projectId?: string;
  apiKey?: string;
  devPlanAllowAllModels?: boolean;
  cachingEnabled?: boolean;
  cacheDurationSeconds?: number;
  retentionLevel?: string;
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : 0;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  const newMonth = month + months;
  const newYear = year + Math.floor(newMonth / 12);
  const finalMonth = newMonth % 12;

  // Clamp day to the max days in the target month
  const maxDay = new Date(Date.UTC(newYear, finalMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(day, maxDay);

  const result = new Date(
    Date.UTC(
      newYear,
      finalMonth,
      newDay,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  );
  return result.toISOString();
}

export default defineChecker({
  type: 'devpass',
  displayName: 'DevPass',
  optionsSchema: z.object({
    session: z.string().trim().min(1, 'DevPass session cookie is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const session = ctx.requireOption<string>('session');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://internal.llmgateway.io/dev-plans/status'
    );

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Cookie: `__Secure-better-auth.session_token=${session}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: DevPassUsageResponse = await response.json();

    const used = toNumber(data.devPlanCreditsUsed);
    const limit = toNumber(data.devPlanCreditsLimit);
    const remaining = toNumber(data.devPlanCreditsRemaining);

    let resetsAt: string | undefined;
    if (data.devPlanBillingCycleStart) {
      const cycleMonths = data.devPlanCycle === 'yearly' ? 12 : 1;
      resetsAt = addMonths(data.devPlanBillingCycleStart, cycleMonths);
    }

    return [
      ctx.allowance({
        key: 'monthly_credits',
        label: 'DevPass subscription',
        unit: 'usd',
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
