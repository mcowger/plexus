import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { KeyConfig, Provider, UserQuota } from '../../lib/api';
import { getAllModelNames } from './helpers';
import type { KeysPageData, QuotaStatusResponse } from './types';

export function useKeysPageData(): KeysPageData {
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [quotas, setQuotas] = useState<Record<string, UserQuota>>({});
  const [quotaStatuses, setQuotaStatuses] = useState<Record<string, QuotaStatusResponse>>({});
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [aliasIds, setAliasIds] = useState<string[]>([]);
  const [defaultQuotaNames, setDefaultQuotaNames] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  // Returns the refreshed per-key status map so callers (e.g. the reset /
  // recompute handlers) can reuse it for the detail modal without issuing a
  // second `getQuotaStatus` fetch for the same key.
  const loadData = async (): Promise<Record<string, QuotaStatusResponse> | null> => {
    try {
      const [k, q, provs, aliases, defaults] = await Promise.all([
        api.getKeys(),
        api.getUserQuotas(),
        api.getProviders(),
        api.getAliases(),
        api.getDefaultQuotas().catch(() => []),
      ]);
      setKeys(k);
      setQuotas(q);
      setProviders(provs);
      setProviderIds(
        provs
          .filter((p) => p.enabled)
          .map((p) => p.id)
          .sort()
      );
      setAliasIds(aliases.map((a) => a.id).sort());
      setDefaultQuotaNames(defaults);

      // Load quota status only for keys that can actually resolve quota
      // entries: keys with assigned `quotas`, or — when `default_quotas` is
      // set — every key (bare keys inherit the defaults). A bare key with no
      // defaults configured can never have entries (the backend returns an
      // empty context immediately), so skip the fetch for those.
      const statuses: Record<string, QuotaStatusResponse> = {};
      await Promise.all(
        k
          .filter((key) => (key.quotas?.length ?? 0) > 0 || defaults.length > 0)
          .map(async (key) => {
            try {
              const status = await api.getQuotaStatus(key.key);
              if (status) {
                statuses[key.key] = status;
              }
            } catch (e) {
              console.error(`Failed to load quota status for ${key.key}`, e);
            }
          })
      );
      setQuotaStatuses(statuses);
      return statuses;
    } catch (e) {
      console.error('Failed to load data', e);
      return null;
    }
  };

  return {
    keys,
    quotas,
    quotaStatuses,
    providers,
    providerIds,
    aliasIds,
    defaultQuotaNames,
    setDefaultQuotaNames,
    allModelNames: getAllModelNames(providers),
    loadData,
  };
}
