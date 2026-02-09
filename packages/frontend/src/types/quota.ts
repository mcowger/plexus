export type QuotaWindowType =
  | 'subscription'
  | 'hourly'
  | 'five_hour'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom';

export type QuotaUnit = 'dollars' | 'requests' | 'tokens' | 'percentage';

export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'exhausted';

export interface QuotaWindow {
  windowType: QuotaWindowType;
  windowLabel?: string;
  description?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  utilizationPercent: number;
  unit: QuotaUnit;
  resetsAt?: string;
  resetInSeconds?: number;
  status?: QuotaStatus;
  estimation?: {
    projectedUsedAtReset: number;
    projectedUtilizationPercent: number;
    willExceed: boolean;
    exceedanceTimestamp?: number; // When quota is projected to be exceeded
    projectionBasedOnMinutes: number; // How many minutes of historical data was used
  };
}

export interface QuotaGroup {
  groupId: string;
  groupLabel: string;
  models: string[];
  windows: QuotaWindow[];
}

export interface QuotaCheckResult {
  provider: string;
  checkerId: string;
  checkedAt: string;
  success: boolean;
  error?: string;
  oauthAccountId?: string;
  oauthProvider?: string;
  windows?: QuotaWindow[];
  groups?: QuotaGroup[];
  rawResponse?: unknown;
}

export interface QuotaCheckerInfo {
  checkerId: string;
  oauthAccountId?: string;
  oauthProvider?: string;
  latest: QuotaSnapshot[];
}

export interface QuotaSnapshot {
  id: number;
  provider: string;
  checkerId: string;
  groupId: string | null;
  windowType: string;
  description?: string;
  checkedAt: string | number;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  utilizationPercent: number | null;
  unit: string | null;
  resetsAt: string | number | null;
  resetInSeconds?: number | null;
  status: string | null;
  success: boolean | number;
  errorMessage: string | null;
  createdAt: string | number;
}
