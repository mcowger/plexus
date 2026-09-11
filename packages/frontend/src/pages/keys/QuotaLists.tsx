import { Edit2, Trash2, Users } from 'lucide-react';
import type { KeyConfig, UserQuota } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { QuotaChip, hasScope } from '../../components/quota';
import { formatNumber, formatCostIn } from '../../lib/format';
import type { CurrencyCode } from '../../lib/currency';

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
        <div className="py-10 text-center text-sm text-text-muted">
          {totalQuotas === 0 ? 'No quotas defined yet' : 'No quotas found'}
        </div>
      ) : (
        filteredQuotas.map(([name, quota]) => {
          const keysUsingQuota = keys.filter((key) => key.quotas?.includes(name)).length;

          return (
            <article key={name} className="rounded-md border border-border-glass bg-bg-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-heading text-sm font-semibold text-text">
                      {name}
                    </span>
                    {quota.shared && (
                      <QuotaChip>
                        <Users size={10} /> shared
                      </QuotaChip>
                    )}
                    {hasScope(quota) && <QuotaChip tone="muted">scoped</QuotaChip>}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
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
                <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Limit</div>
                  <div className="truncate font-mono text-text">
                    {quota.limitType === 'cost'
                      ? `${formatCostIn(quota.limit, { currency, rate, symbol, decimals: 5 })} ${quota.limitType}`
                      : `${formatNumber(quota.limit)} ${quota.limitType}`}
                  </div>
                </div>
                <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Keys</div>
                  <div className="truncate font-medium text-text-secondary">
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
      <table className="w-full border-collapse font-body text-[13px]">
        <thead>
          <tr>
            <th
              className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
              style={{ paddingLeft: '24px' }}
            >
              Name
            </th>
            <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
              Type
            </th>
            <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
              Limit
            </th>
            <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
              Keys Using
            </th>
            <th
              className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
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
                  className="px-4 py-3 text-left border-b border-border-glass text-text"
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
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-bg-subtle text-text-secondary">
                    {quota.type}
                    {quota.type === 'rolling' && quota.duration && (
                      <span className="text-text-muted">({quota.duration})</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                  <span className="font-mono text-xs">
                    {quota.limitType === 'cost'
                      ? `${formatCostIn(quota.limit, { currency, rate, symbol, decimals: 5 })} ${quota.limitType}`
                      : `${formatNumber(quota.limit)} ${quota.limitType}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md ${
                      keysUsingQuota > 0
                        ? 'bg-primary/10 text-primary'
                        : 'bg-bg-subtle text-text-muted'
                    }`}
                  >
                    {keysUsingQuota} key{keysUsingQuota !== 1 ? 's' : ''}
                  </span>
                </td>
                <td
                  className="px-4 py-3 text-left border-b border-border-glass text-text"
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
              <td colSpan={5} className="text-center text-text-muted p-12">
                {totalQuotas === 0 ? 'No quotas defined yet' : 'No quotas found'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);
