export type MeterKind = 'balance' | 'allowance';
export type MeterStatus = 'ok' | 'warning' | 'critical' | 'exhausted';
export type Utilization = number | 'unknown' | 'not_applicable';

export interface Meter {
  key: string;
  label: string;
  kind: MeterKind;
  unit: string;
  limit?: number;
  used?: number;
  remaining?: number;
  utilizationPercent: Utilization;
  status: MeterStatus;
  periodValue?: number;
  periodUnit?: string;
  periodCycle?: string;
  resetsAt?: string;
  group?: string;
  scope?: string;
}

export interface QuotaCheckerInfo {
  checkerId: string;
  checkerType?: string;
  provider?: string;
  checkedAt?: string;
  success: boolean;
  error?: string;
  meters: Meter[];
  oauthAccountId?: string;
  oauthProvider?: string;
}

export interface QuotaWindow {
  windowLabel?: string;
  used?: number;
  limit?: number;
  status?: MeterStatus;
  unit?: string;
  utilizationPercent?: Utilization;
}

export interface QuotaCheckResult {
  success: boolean;
  error?: string;
  windows?: QuotaWindow[];
}

export interface QuotaCheckerType {
  type: string;
  displayName: string;
  custom?: boolean;
}

export interface CustomQuotaChecker {
  id: string;
  type: string;
  displayName: string;
  code: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaCheckersResponse {
  knownTypes: QuotaCheckerType[];
  configured: (QuotaCheckerInfo & { displayName: string; pending: boolean })[];
}

/**
 * Scope-restriction fields shared by every quota definition type. Empty (all
 * fields absent/empty) means the quota applies to every provider/model pair.
 * Mirrors `QuotaScopeFields` in `packages/backend/src/config.ts`.
 */
export interface QuotaScope {
  allowedProviders?: string[];
  excludedProviders?: string[];
  allowedModels?: string[];
  excludedModels?: string[];
}

export interface UserQuota extends QuotaScope {
  type: 'rolling' | 'daily' | 'weekly' | 'monthly';
  limitType: 'requests' | 'tokens' | 'cost';
  limit: number;
  duration?: string; // Required for rolling type
  // Pools usage across every key referencing this quota into a single bucket
  // instead of counting each key independently.
  shared?: boolean;
  // Early-warning threshold as a fraction of `limit`, e.g. 0.8 = 80%. Must be
  // in (0, 1) exclusive when set (validated backend-side).
  warnAt?: number;
}

/**
 * Wire shape of one entry in the `quotas[]` array returned by
 * `GET /v0/management/quota/status/:key` and `GET /v0/management/self/quota`.
 * Mirrors `QuotaSnapshotJson` in
 * `packages/backend/src/routes/management/_quota-response.ts`.
 */
export interface QuotaStatusEntry {
  name: string;
  limitType: 'requests' | 'tokens' | 'cost';
  limit: number;
  currentUsage: number;
  remaining: number;
  allowed: boolean;
  resetsAt: string;
  scope: QuotaScope;
  global: boolean;
  shared: boolean;
  warnAt?: number;
  source: 'assigned' | 'default';
}

export interface QuotaConfig {
  id: string;
  type:
    | 'synthetic'
    | 'naga'
    | 'nanogpt'
    | 'codex'
    | 'claude-code'
    | 'zai'
    | 'moonshot'
    | 'minimax'
    | 'minimax-coding'
    | 'kimi-code'
    | 'openrouter'
    | 'kilo';
  provider: string;
  enabled: boolean;
  intervalMinutes: number;
  options: {
    apiKey?: string;
    endpoint?: string;
    max?: number;
    oauthProvider?: string;
    oauthAccountId?: string;
  };
  implicit?: boolean;
}
