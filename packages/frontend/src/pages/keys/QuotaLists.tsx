import { Edit2, Trash2, Users } from 'lucide-react';

import { hasScope, QuotaChip } from '../../components/quota';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { KeyConfig, UserQuota } from '../../lib/api';
import type { CurrencyCode } from '../../lib/currency';
import { formatCostIn, formatNumber } from '../../lib/format';

interface QuotaListsProps {
  filteredQuotas: Array<[string, UserQuota]>;
  totalQuotas: number;
  keys: KeyConfig[];
  currency: CurrencyCode;
  rate: number;
  symbol: string;
  onEditQuota: (name: string, quota: UserQuota) => void;
  onDeleteQuota: (name: string) => void;
}

export const QuotaLists = ({
  filteredQuotas,
  totalQuotas,
  keys,
  currency,
  rate,
  symbol,
  onEditQuota,
  onDeleteQuota,
}: QuotaListsProps) => (
  <Card title="User Quotas" className="mb-6">
    <div className="space-y-3 md:hidden">
      {filteredQuotas.length === 0 ? (
        <div className="text-text-muted py-10 text-center text-sm">
          {totalQuotas === 0 ? 'No quotas defined yet' : 'No quotas found'}
        </div>
      ) : (
        filteredQuotas.map(([name, quota]) => {
          const keysUsingQuota = keys.filter((key) => key.quotas?.includes(name)).length;

          return (
            <article key={name} className="border-border-glass bg-bg-subtle rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-heading text-text truncate text-sm font-semibold">
                      {name}
                    </span>
                    {quota.shared && (
                      <QuotaChip>
                        <Users size={10} /> shared
                      </QuotaChip>
                    )}
                    {hasScope(quota) && <QuotaChip tone="muted">scoped</QuotaChip>}
                  </div>
                  <div className="text-text-muted mt-1 text-xs">
                    {quota.type}
                    {quota.type === 'rolling' && quota.duration ? ` (${quota.duration})` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEditQuota(name, quota)}
                    aria-label={`Edit ${name}`}
                  >
                    <Edit2 size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteQuota(name)}
                    className="text-danger"
                    aria-label={`Delete ${name}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="border-border-glass bg-bg-glass min-w-0 rounded border px-2 py-1.5">
                  <div className="text-text-muted text-[10px] tracking-wider uppercase">Limit</div>
                  <div className="text-text truncate font-mono">
                    {quota.limitType === 'cost'
                      ? `${formatCostIn(quota.limit, { currency, rate, symbol, decimals: 5 })} ${quota.limitType}`
                      : `${formatNumber(quota.limit)} ${quota.limitType}`}
                  </div>
                </div>
                <div className="border-border-glass bg-bg-glass min-w-0 rounded border px-2 py-1.5">
                  <div className="text-text-muted text-[10px] tracking-wider uppercase">Keys</div>
                  <div className="text-text-secondary truncate font-medium">
                    {keysUsingQuota} key{keysUsingQuota !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            </article>
          );
        })
      )}
    </div>

    <div className="hidden overflow-x-auto md:block">
      <table className="font-body w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th
              className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
              style={{ paddingLeft: '24px' }}
            >
              Name
            </th>
            <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase">
              Type
            </th>
            <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase">
              Limit
            </th>
            <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase">
              Keys Using
            </th>
            <th
              className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
              style={{ paddingRight: '24px', textAlign: 'right' }}
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredQuotas.map(([name, quota]) => {
            const keysUsingQuota = keys.filter((key) => key.quotas?.includes(name)).length;

            return (
              <tr key={name} className="hover:bg-bg-hover">
                <td
                  className="border-border-glass text-text border-b px-4 py-3 text-left"
                  style={{ fontWeight: 600, paddingLeft: '24px' }}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{name}</span>
                    {quota.shared && (
                      <QuotaChip>
                        <Users size={10} /> shared
                      </QuotaChip>
                    )}
                    {hasScope(quota) && <QuotaChip tone="muted">scoped</QuotaChip>}
                  </div>
                </td>
                <td className="border-border-glass text-text border-b px-4 py-3 text-left">
                  <span className="bg-bg-subtle text-text-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium">
                    {quota.type}
                    {quota.type === 'rolling' && quota.duration && (
                      <span className="text-text-muted">({quota.duration})</span>
                    )}
                  </span>
                </td>
                <td className="border-border-glass text-text border-b px-4 py-3 text-left">
                  <span className="font-mono text-xs">
                    {quota.limitType === 'cost'
                      ? `${formatCostIn(quota.limit, { currency, rate, symbol, decimals: 5 })} ${quota.limitType}`
                      : `${formatNumber(quota.limit)} ${quota.limitType}`}
                  </span>
                </td>
                <td className="border-border-glass text-text border-b px-4 py-3 text-left">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                      keysUsingQuota > 0
                        ? 'bg-primary/10 text-primary'
                        : 'bg-bg-subtle text-text-muted'
                    }`}
                  >
                    {keysUsingQuota} key{keysUsingQuota !== 1 ? 's' : ''}
                  </span>
                </td>
                <td
                  className="border-border-glass text-text border-b px-4 py-3 text-left"
                  style={{ paddingRight: '24px', textAlign: 'right' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button variant="ghost" size="sm" onClick={() => onEditQuota(name, quota)}>
                      <Edit2 size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteQuota(name)}
                      style={{ color: 'var(--color-danger)' }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
          {filteredQuotas.length === 0 && (
            <tr>
              <td colSpan={5} className="text-text-muted p-12 text-center">
                {totalQuotas === 0 ? 'No quotas defined yet' : 'No quotas found'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);
