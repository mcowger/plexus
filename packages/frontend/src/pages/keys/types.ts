import type { Dispatch, SetStateAction } from 'react';
import { api } from '../../lib/api';
import type { KeyConfig, Provider, UserQuota } from '../../lib/api';

export type QuotaStatusResponse = NonNullable<Awaited<ReturnType<typeof api.getQuotaStatus>>>;
export type ExpiryUnit = 'minutes' | 'hours' | 'days';
export type EditingQuota = UserQuota & { name: string };
export type LoadKeysData = () => Promise<Record<string, QuotaStatusResponse> | null>;

export const EMPTY_KEY: KeyConfig = {
  key: '',
  secret: '',
  comment: '',
};

export const EMPTY_QUOTA: EditingQuota = {
  name: '',
  type: 'rolling',
  limitType: 'requests',
  limit: 1000,
  duration: '1h',
  allowedProviders: [],
  excludedProviders: [],
  allowedModels: [],
  excludedModels: [],
  shared: false,
  warnAt: undefined,
};

export interface KeysPageData {
  keys: KeyConfig[];
  quotas: Record<string, UserQuota>;
  quotaStatuses: Record<string, QuotaStatusResponse>;
  providers: Provider[];
  providerIds: string[];
  aliasIds: string[];
  defaultQuotaNames: string[];
  setDefaultQuotaNames: Dispatch<SetStateAction<string[]>>;
  allModelNames: string[];
  loadData: LoadKeysData;
}
