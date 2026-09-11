import {
  BarChart3,
  Ban,
  Check,
  ChevronDown,
  Copy,
  Edit2,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react';
import type { KeyConfig } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { QuotaChip } from '../../components/quota';
import { formatQuotaValue, mostConstrained, quotaUsagePercent } from '../../lib/quota';
import { getQuotaStatusColor, formatExpiry } from './helpers';
import type { QuotaStatusResponse } from './types';
import type { CurrencyCode } from '../../lib/currency';

interface KeyListsProps {
  activeKeys: KeyConfig[];
  disabledKeys: KeyConfig[];
  defaultQuotaNames: string[];
  quotaStatuses: Record<string, QuotaStatusResponse>;
  copiedKey: string | null;
  currency: CurrencyCode;
  rate: number;
  symbol: string;
  showDisabledKeys: boolean;
  onSetShowDisabledKeys: (show: boolean) => void;
  onEditKey: (key: KeyConfig) => void;
  onDisableKey: (key: KeyConfig) => void;
  onDeleteKey: (keyName: string) => void;
  onCopy: (text: string, keyId: string) => void;
  onViewQuotaStatus: (keyName: string) => void;
  onClearQuota: (keyName: string) => void;
}

export const KeyLists = ({
  activeKeys,
  disabledKeys,
  defaultQuotaNames,
  quotaStatuses,
  copiedKey,
  currency,
  rate,
  symbol,
  showDisabledKeys,
  onSetShowDisabledKeys,
  onEditKey,
  onDisableKey,
  onDeleteKey,
  onCopy,
  onViewQuotaStatus,
  onClearQuota,
}: KeyListsProps) => (
  <>
    <Card title="Active Keys" className="mb-6">
      <div className="space-y-3 md:hidden">
        {activeKeys.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">No keys found</div>
        ) : (
          activeKeys.map((key) => {
            const status = quotaStatuses[key.key];
            const primary = status ? mostConstrained(status.quotas) : null;
            const usagePercent = primary ? quotaUsagePercent(primary) : 0;
            const quotaNames = key.quotas && key.quotas.length > 0 ? key.quotas : null;
            const usingDefaults = !quotaNames && defaultQuotaNames.length > 0;

            return (
              <article
                key={key.key}
                className="rounded-md border border-border-glass bg-bg-subtle p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onEditKey(key)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <div className="truncate font-heading text-sm font-semibold text-text">
                        {key.key}
                      </div>
                    </div>
                    {key.comment && (
                      <div className="mt-1 truncate text-xs text-text-muted">{key.comment}</div>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditKey(key)}
                      aria-label={`Edit ${key.key}`}
                    >
                      <Edit2 size={14} />
                    </Button>
                    {key.expiresAt && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDisableKey(key)}
                        className="text-danger"
                        aria-label={`Disable ${key.key}`}
                        title="Disable key"
                      >
                        <Ban size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteKey(key.key)}
                      className="text-danger"
                      aria-label={`Delete ${key.key}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted">
                      Secret
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="min-w-0 truncate font-mono text-text">
                        {key.secret.substring(0, 5)}...
                      </span>
                      <button
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-hover hover:text-primary"
                        onClick={() => onCopy(key.secret, key.key)}
                        title="Copy secret"
                        type="button"
                      >
                        {copiedKey === key.key ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted">
                      Quota
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {quotaNames ? (
                        quotaNames.map((name) => <QuotaChip key={name}>{name}</QuotaChip>)
                      ) : usingDefaults ? (
                        <>
                          {defaultQuotaNames.map((name) => (
                            <QuotaChip key={name} tone="muted">
                              {name}
                            </QuotaChip>
                          ))}
                          <QuotaChip tone="muted">default</QuotaChip>
                        </>
                      ) : (
                        <span className="text-text-secondary">-</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded border border-border-glass bg-bg-glass px-2 py-2">
                  {primary ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-text-muted truncate">{primary.name}</span>
                        <span className="font-medium text-text">
                          {formatQuotaValue(primary.currentUsage, primary.limitType, {
                            currency,
                            rate,
                            symbol,
                          })}{' '}
                          /{' '}
                          {formatQuotaValue(primary.limit, primary.limitType, {
                            currency,
                            rate,
                            symbol,
                          })}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${usagePercent}%`,
                            backgroundColor: getQuotaStatusColor(usagePercent),
                          }}
                        />
                      </div>
                      {status && status.quotas.length > 1 && (
                        <p className="text-[11px] text-text-muted">
                          +{status.quotas.length - 1} more quota
                          {status.quotas.length - 1 !== 1 ? 's' : ''}
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewQuotaStatus(key.key)}
                          leftIcon={<BarChart3 size={14} />}
                        >
                          Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onClearQuota(key.key)}
                          leftIcon={<RefreshCw size={14} />}
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-text-muted">
                      {quotaNames || usingDefaults
                        ? 'Loading quota status...'
                        : 'No quota assigned'}
                    </div>
                  )}
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
                Key Name
              </th>
              <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                Secret
              </th>
              <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                Quota
              </th>
              <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                Status
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
            {activeKeys.map((key) => {
              const status = quotaStatuses[key.key];
              const primary = status ? mostConstrained(status.quotas) : null;
              const usagePercent = primary ? quotaUsagePercent(primary) : 0;
              const quotaNames = key.quotas && key.quotas.length > 0 ? key.quotas : null;
              const usingDefaults = !quotaNames && defaultQuotaNames.length > 0;

              return (
                <tr key={key.key} className="hover:bg-bg-hover">
                  <td
                    className="px-4 py-3 text-left border-b border-border-glass text-text"
                    style={{ fontWeight: 600, paddingLeft: '24px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{key.key}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          backgroundColor: 'var(--color-bg-subtle)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {key.secret.substring(0, 5)}...
                      </span>
                      <button
                        className="bg-transparent border-0 text-text-muted p-1.5 rounded-sm cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-bg-hover hover:text-primary active:scale-95"
                        onClick={() => onCopy(key.secret, key.key)}
                        title="Copy Secret"
                        style={copiedKey === key.key ? { color: 'var(--color-success)' } : {}}
                      >
                        {copiedKey === key.key ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                    {quotaNames ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {quotaNames.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary"
                          >
                            <Shield size={12} />
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : usingDefaults ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {defaultQuotaNames.map((name) => (
                          <QuotaChip key={name} tone="muted">
                            {name}
                          </QuotaChip>
                        ))}
                        <QuotaChip tone="muted">default</QuotaChip>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                    {primary ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: getQuotaStatusColor(usagePercent),
                          }}
                        />
                        <span style={{ fontSize: '12px' }}>
                          {formatQuotaValue(primary.currentUsage, primary.limitType, {
                            currency,
                            rate,
                            symbol,
                          })}{' '}
                          /{' '}
                          {formatQuotaValue(primary.limit, primary.limitType, {
                            currency,
                            rate,
                            symbol,
                          })}
                        </span>
                        {status && status.quotas.length > 1 && (
                          <span className="text-[11px] text-text-muted">
                            (+{status.quotas.length - 1})
                          </span>
                        )}
                        <button
                          className="bg-transparent border-0 text-text-muted p-1 rounded-sm cursor-pointer hover:text-primary"
                          onClick={() => onViewQuotaStatus(key.key)}
                          title="View details"
                        >
                          <BarChart3 size={14} />
                        </button>
                      </div>
                    ) : quotaNames || usingDefaults ? (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                        Loading...
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>-</span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-left border-b border-border-glass text-text"
                    style={{ paddingRight: '24px', textAlign: 'right' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <Button variant="ghost" size="sm" onClick={() => onEditKey(key)}>
                        <Edit2 size={14} />
                      </Button>
                      {key.expiresAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDisableKey(key)}
                          title="Disable key"
                          style={{ color: 'var(--color-danger)' }}
                        >
                          <Ban size={14} />
                        </Button>
                      )}
                      {(quotaNames || usingDefaults) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onClearQuota(key.key)}
                          title="Reset quota"
                        >
                          <RefreshCw size={14} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteKey(key.key)}
                        style={{ color: 'var(--color-danger)' }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {activeKeys.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-text-muted p-12">
                  No keys found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>

    <Card className="mb-6">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => onSetShowDisabledKeys(!showDisabledKeys)}
        aria-expanded={showDisabledKeys}
      >
        <span className="font-heading text-sm font-semibold text-text">
          Disabled Keys ({disabledKeys.length})
        </span>
        <ChevronDown
          size={16}
          className={`text-text-muted transition-transform ${showDisabledKeys ? 'rotate-180' : ''}`}
        />
      </button>
      {showDisabledKeys && (
        <div className="mt-4 overflow-x-auto">
          {disabledKeys.length === 0 ? (
            <div className="py-6 text-center text-sm text-text-muted">No disabled keys found</div>
          ) : (
            <table className="w-full border-collapse font-body text-[13px]">
              <thead>
                <tr className="border-b border-border-glass text-left text-[11px] uppercase tracking-wider text-text-secondary">
                  <th className="px-3 py-2">Key Name</th>
                  <th className="px-3 py-2">Expiration</th>
                  <th className="px-3 py-2">Disabled</th>
                  <th className="px-3 py-2">Comment</th>
                </tr>
              </thead>
              <tbody>
                {disabledKeys.map((key) => (
                  <tr key={key.key} className="border-b border-border-glass text-text">
                    <td className="px-3 py-3 font-medium">{key.key}</td>
                    <td className="px-3 py-3">
                      {key.expiresAt ? formatExpiry(key.expiresAt) : '-'}
                    </td>
                    <td className="px-3 py-3">
                      {key.disabledAt ? formatExpiry(key.disabledAt) : 'Expired'}
                    </td>
                    <td className="px-3 py-3 text-text-muted">{key.comment || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  </>
);
