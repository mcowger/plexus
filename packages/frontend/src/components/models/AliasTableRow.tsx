import React from 'react';
import { Edit2, Trash2, Clock, Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Switch } from '../ui/Switch';
import { Alias, Provider, Cooldown } from '../../lib/api';
import { ModelTypeBadge } from './ModelTypeBadge';
import { formatMsToMinSec } from '@plexus/shared';

interface AliasTableRowProps {
  alias: Alias;
  providers: Provider[];
  cooldowns: Cooldown[];
  testStates: Record<string, any>;
  onEdit: (alias: Alias) => void;
  onDelete: (alias: Alias) => void;
  onToggleTarget: (alias: Alias, targetIndex: number, newState: boolean) => void;
  onTestTarget: (
    aliasId: string,
    idx: number,
    providerId: string,
    modelId: string,
    types: string[]
  ) => void;
}

export const AliasTableRow: React.FC<AliasTableRowProps> = ({
  alias,
  providers,
  cooldowns,
  testStates,
  onEdit,
  onDelete,
  onToggleTarget,
  onTestTarget,
}) => {
  return (
    <tr className="hover:bg-bg-hover">
      <td
        className="px-4 py-3 text-left border-b border-border-glass text-text"
        style={{ fontWeight: 600, paddingLeft: '24px' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div
            onClick={() => onEdit(alias)}
            className="flex items-center gap-2 cursor-pointer flex-1"
          >
            <Edit2 size={12} className="opacity-50" />
            {alias.id}
          </div>
          <button
            onClick={() => onDelete(alias)}
            className="bg-none border-none cursor-pointer p-1 rounded color-danger opacity-60 transition-opacity hover:opacity-100"
            title="Delete alias"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
        <ModelTypeBadge type={alias.type} />
      </td>
      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
        {alias.aliases && alias.aliases.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {alias.aliases.map((a) => (
              <span
                key={a}
                className="inline-flex items-center rounded px-2 py-1 text-xs font-medium border border-border-glass text-text-secondary text-[10px]"
              >
                {a}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-text-secondary text-xs">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
        <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium border-border-glass text-text-secondary text-[11px] capitalize">
          {alias.selector || 'random'} / {alias.priority || 'selector'}
        </span>
      </td>
      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
        {alias.metadata ? (
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary capitalize">
              {alias.metadata.source}
            </span>
          </div>
        ) : (
          <span className="text-text-secondary text-xs">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-left border-b border-border-glass text-text pr-6">
        <div className="flex flex-col gap-1.5">
          {alias.targets.map((t, i) => {
            const provider = providers.find((p) => p.id === t.provider);
            const isProviderDisabled = provider?.enabled === false;
            const isTargetDisabled = t.enabled === false;
            const isDisabled = isProviderDisabled || isTargetDisabled;
            const testKey = `${alias.id}-${i}`;
            const testState = testStates[testKey];

            const cooldown = cooldowns.find(
              (c) => c.provider === t.provider && c.model === t.model && !c.accountId
            );
            const isCoolingDown = !!cooldown;
            const cooldownDisplay = cooldown ? formatMsToMinSec(cooldown.timeRemainingMs) : '';

            return (
              <div
                key={i}
                className={`flex items-center gap-2 text-xs transition-opacity ${
                  isDisabled ? 'opacity-70 line-through text-danger' : 'text-text-secondary'
                }`}
              >
                {isCoolingDown && (
                  <div
                    className="flex items-center gap-1 text-warning font-medium text-[11px]"
                    title={`On cooldown for ${cooldownDisplay}`}
                  >
                    <Clock size={12} />
                    <span>{cooldownDisplay}</span>
                  </div>
                )}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isDisabled) {
                      let testApiTypes: string[] = ['chat'];
                      if (alias.type === 'embeddings') testApiTypes = ['embeddings'];
                      else if (alias.type === 'image') testApiTypes = ['images'];
                      else if (alias.type === 'responses') testApiTypes = ['responses'];

                      onTestTarget(alias.id, i, t.provider, t.model, testApiTypes);
                    }
                  }}
                  className={`flex items-center cursor-pointer transition-opacity ${
                    isDisabled ? 'cursor-not-allowed opacity-50' : 'opacity-100'
                  } mr-4`}
                >
                  {testState?.loading ? (
                    <Loader2 size={14} className="animate-spin text-text-secondary" />
                  ) : testState?.showResult && testState.result === 'success' ? (
                    <CheckCircle size={14} className="text-success" />
                  ) : testState?.showResult && testState.result === 'error' ? (
                    <XCircle size={14} className="text-danger" />
                  ) : (
                    <Play
                      size={14}
                      className={`text-primary ${isDisabled ? 'invisible' : 'opacity-60'}`}
                    />
                  )}
                </div>
                <Switch
                  checked={t.enabled !== false}
                  onChange={(val) => onToggleTarget(alias, i, val)}
                  size="sm"
                  disabled={isProviderDisabled}
                />
                <div className="flex-1 truncate">
                  {t.provider} &rarr; {t.model}
                  {testState?.showResult && testState.message && (
                    <span
                      className={`ml-2 text-[11px] italic ${testState.result === 'success' ? 'text-success' : 'text-danger'}`}
                    >
                      {testState.message}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
};
