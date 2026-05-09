import { Edit2, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import type { Provider } from '../../lib/api';

interface Props {
  providers: Provider[];
  getQuotaDisplay: (provider: Provider) => React.ReactNode;
  onEdit: (provider: Provider) => void;
  onToggleEnabled: (provider: Provider, newState: boolean) => void;
  onDelete: (provider: Provider) => void;
}

const countModels = (p: Provider): number => {
  if (!p.models) return 0;
  if (Array.isArray(p.models)) return p.models.length;
  if (typeof p.models === 'object') return Object.keys(p.models).length;
  return 0;
};

export function ProviderList({
  providers,
  getQuotaDisplay,
  onEdit,
  onToggleEnabled,
  onDelete,
}: Props) {
  return (
    <>
      {/* Mobile cards */}
      <div className="space-y-3 p-3 md:hidden">
        {providers.length === 0 ? (
          <div className="rounded-lg border border-border-glass bg-bg-subtle p-4 text-center text-sm text-text-secondary">
            No providers configured
          </div>
        ) : (
          providers.map((p) => (
            <article
              key={p.id}
              onClick={() => onEdit(p)}
              className="rounded-lg border border-border-glass bg-bg-card p-3 transition-colors hover:border-primary/30 hover:bg-bg-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Edit2 size={12} className="shrink-0 text-text-muted" />
                    <h3 className="truncate text-sm font-semibold text-text">{p.id}</h3>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-text-secondary">{p.name}</p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={p.enabled !== false}
                    onChange={(val) => onToggleEnabled(p, val)}
                    size="sm"
                  />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-bg-subtle p-2">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Models</div>
                  <div className="text-text">{countModels(p)}</div>
                </div>
                <div className="rounded-md bg-bg-subtle p-2">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">
                    Quota/Balance
                  </div>
                  <div className="mt-1 min-h-5">{getQuotaDisplay(p) || '-'}</div>
                </div>
              </div>
              <div className="mt-3 flex justify-end border-t border-border-glass pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p);
                  }}
                  className="text-danger"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </article>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse font-body text-[13px]">
          <thead>
            <tr>
              <th
                className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                style={{ paddingLeft: '24px' }}
              >
                ID / Name
              </th>
              <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                Models
              </th>
              <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                Quota/Balance
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
            {providers.map((p) => (
              <tr
                key={p.id}
                onClick={() => onEdit(p)}
                style={{ cursor: 'pointer' }}
                className="hover:bg-bg-hover"
              >
                <td
                  className="px-4 py-3 text-left border-b border-border-glass text-text"
                  style={{ paddingLeft: '24px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Edit2 size={12} style={{ opacity: 0.5 }} />
                    <div style={{ fontWeight: 600 }}>{p.id}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      ( {p.name} )
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={p.enabled !== false}
                      onChange={(val) => onToggleEnabled(p, val)}
                      size="sm"
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                  {countModels(p)}
                </td>
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                  {getQuotaDisplay(p)}
                </td>
                <td
                  className="px-4 py-3 text-left border-b border-border-glass text-text"
                  style={{ paddingRight: '24px', textAlign: 'right' }}
                >
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(p);
                      }}
                      style={{ color: 'var(--color-danger)' }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
