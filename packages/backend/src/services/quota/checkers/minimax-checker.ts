import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface MiniMaxBalanceResponse {
  available_amount: string;
  cash_balance: string;
  voucher_balance: string;
  credit_balance: string;
  owed_amount: string;
  balance_alert_switch: boolean;
  balance_alert_threshold: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

export class MiniMaxQuotaChecker extends QuotaChecker {
  async checkQuota(): Promise<QuotaCheckResult> {
    const groupid = this.requireOption<string>('groupid').trim();
    const hertzSession = this.requireOption<string>('hertzSession').trim();

    try {
      const endpoint = `https://platform.minimax.io/account/query_balance?GroupId=${encodeURIComponent(groupid)}`;
      logger.debug(`[minimax] Calling ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Cookie': `HERTZ-SESSION=${hertzSession}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: MiniMaxBalanceResponse = await response.json();

      if (data.base_resp?.status_code !== 0) {
        return this.errorResult(new Error(`MiniMax API error: ${data.base_resp?.status_msg || 'unknown error'}`));
      }

      const availableAmount = Number.parseFloat(data.available_amount);
      if (!Number.isFinite(availableAmount)) {
        return this.errorResult(new Error(`Invalid available_amount received: ${data.available_amount}`));
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        availableAmount,
        'dollars',
        undefined,
        'MiniMax account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
