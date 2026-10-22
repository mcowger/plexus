import { formatMsToMinSec, INDEFINITE_COOLDOWN_THRESHOLD_MS } from '@plexus/shared';
import { CheckCircle, Clock, Edit2, Link2, Loader2, Play, Trash2, XCircle } from 'lucide-react';
import React from 'react';

import { Alias, Cooldown, Provider } from '../../lib/api';
import { getAliasProviderLabels, getAliasTargetCount } from '../../lib/modelList';
import { dedupeStrings } from '../../lib/modelOptions';
import { SELECTOR_LABELS } from '../../lib/selectors';
import { Badge } from '../ui/Badge';
import { CopyButton } from '../ui/CopyButton';
import { Switch } from '../ui/Switch';

interface AliasTableRowProps {
  alias: Alias;
  providers: Provider[];
  cooldowns: Cooldown[];
  testStates: Record<string, any>;
  onEdit: (alias: Alias) => void;
  onDelete: (alias: Alias) => void;
  onToggleTarget: (
    alias: Alias,
    groupIndex: number,
    targetIndex: number,
    newState: boolean
  ) => void;
  onTestTarget: (
    aliasId: string,
    testKey: string,
    providerId: string,
    modelId: string,
    types: string[]
  ) => void;
  onDismissTestMessage: (testKey: string) => void;
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
  onDismissTestMessage,
}) => {
  const providerLabels = getAliasProviderLabels(alias, providers);
  const targetCount = getAliasTargetCount(alias);

  return (
    <tr className="hover:bg-bg-hover">
      <td
        className="border-border-glass text-text border-b px-4 py-1.5 text-left"
        style={{ fontWeight: 600, paddingLeft: '24px' }}
      >
        <div className="flex items-center gap-2">
          <div
            onClick={() => onEdit(alias)}
            className="flex cursor-pointer items-center gap-2 whitespace-nowrap"
          >
            <Edit2 size={12} className="opacity-50" />
            {alias.id}
          </div>
          <CopyButton value={alias.id} size="sm" />
          <button
            onClick={() => onDelete(alias)}
            className="color-danger cursor-pointer rounded border-none bg-none p-1 opacity-60 transition-opacity hover:opacity-100"
            title="Delete alias"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-5 text-[10px]">
          <span>
            <span className="text-text-muted">Type: </span>
            <span
              className={
                (
                  {
                    embeddings: 'text-success',
                    transcriptions: 'text-purple-400',
                    speech: 'text-orange-400',
                    image: 'text-pink-400',
                    text: 'text-gray-400',
                  } as Record<string, string>
                )[alias.type ?? 'text'] ?? 'text-gray-400'
              }
            >
              {alias.type ?? 'text'}
            </span>
          </span>
          {alias.metadata && (
            <span>
              <span className="text-text-muted">Metadata: </span>
              <span className="text-primary capitalize">{alias.metadata.source}</span>
            </span>
          )}
        </div>
        {alias.aliases && alias.aliases.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1 pl-5">
            {dedupeStrings(alias.aliases).map((a) => (
              <span
                key={a}
                className="text-text-muted inline-flex w-fit items-center gap-1 text-[10px]"
              >
                {a}
                <CopyButton value={a} size="sm" />
              </span>
            ))}
          </div>
        )}
      </td>

      <td className="border-border-glass text-text border-b px-4 py-1.5 text-left">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {providerLabels.length > 0 ? (
              providerLabels.map((providerLabel) => (
                <Badge key={providerLabel} status="neutral" noDot>
                  {providerLabel}
                </Badge>
              ))
            ) : (
              <span className="text-text-muted text-[11px]">No providers</span>
            )}
          </div>
          <div className="text-text-muted text-[11px]">
            {targetCount} target{targetCount === 1 ? '' : 's'}
          </div>
        </div>
      </td>

      <td className="border-border-glass text-text border-b px-4 py-1.5 pr-6 text-left">
        <div className="flex flex-row items-stretch gap-2">
          {alias.target_groups.map((group, groupIdx) => (
            <div
              key={group.name}
              className="border-border-glass/50 bg-bg-glass/30 flex min-w-0 flex-1 flex-col gap-0.5 rounded border p-1.5"
            >
              <div className="text-text-muted flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase">
                <span className="opacity-40">{groupIdx + 1}.</span>
                <span>{group.name}</span>
                <span className="opacity-50">·</span>
                <span>{SELECTOR_LABELS[group.selector] ?? group.selector}</span>
                <CopyButton
                  value={`direct/${alias.id}/${group.name}`}
                  size="sm"
                  className="ml-0.5"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                {group.targets.map((t, targetIdx) => {
                  if (t.alias) {
                    const isTargetDisabled = t.enabled === false;
                    return (
                      <div
                        key={`alias-${t.alias}-${targetIdx}`}
                        className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                          isTargetDisabled
                            ? 'text-danger line-through opacity-70'
                            : 'text-text-secondary'
                        }`}
                      >
                        <Link2 size={12} className="text-primary opacity-70" />
                        <Switch
                          checked={t.enabled !== false}
                          onChange={(val) => onToggleTarget(alias, groupIdx, targetIdx, val)}
                          size="sm"
                        />
                        <div className="flex-1 truncate" title={`alias: ${t.alias}`}>
                          alias: {t.alias}
                        </div>
                      </div>
                    );
                  }

                  const provider = providers.find((p) => p.id === t.provider);
                  const isProviderDisabled = provider?.enabled === false;
                  const isTargetDisabled = t.enabled === false;
                  const isDisabled = isProviderDisabled || isTargetDisabled;
                  const testKey = `${alias.id}-${groupIdx}-${targetIdx}`;
                  const testState = testStates[testKey];

                  const cooldown = cooldowns.find(
                    (c) => c.provider === t.provider && c.model === t.model && !c.accountId
                  );
                  const isCoolingDown = !!cooldown;
                  const cooldownDisplay = cooldown
                    ? formatMsToMinSec(cooldown.timeRemainingMs, cooldown.lastError)
                    : '';
                  const isIndefinite =
                    cooldown && cooldown.timeRemainingMs >= INDEFINITE_COOLDOWN_THRESHOLD_MS;
                  const titlePrefix = isIndefinite ? 'On cooldown ' : 'On cooldown for ';

                  return (
                    <React.Fragment key={`${t.provider}-${t.model}-${targetIdx}`}>
                      <div
                        className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                          isDisabled ? 'text-danger line-through opacity-70' : 'text-text-secondary'
                        }`}
                      >
                        {isCoolingDown && (
                          <div
                            className="text-warning flex items-center gap-1 text-[11px] font-medium"
                            title={`${titlePrefix}${cooldownDisplay}`}
                          >
                            <Clock size={12} />
                            <span>{cooldownDisplay}</span>
                          </div>
                        )}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isDisabled && t.provider && t.model) {
                              let testApiTypes: string[] = ['chat'];
                              if (alias.type === 'embeddings') testApiTypes = ['embeddings'];
                              else if (alias.type === 'image') testApiTypes = ['images'];
                              else if (alias.type === 'decisions') testApiTypes = ['decisions'];

                              onTestTarget(alias.id, testKey, t.provider, t.model, testApiTypes);
                            }
                          }}
                          className={`flex cursor-pointer items-center transition-opacity ${
                            isDisabled ? 'cursor-not-allowed opacity-50' : 'opacity-100'
                          }`}
                        >
                          {testState?.loading ? (
                            <Loader2 size={14} className="text-text-secondary animate-spin" />
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
                          onChange={(val) => onToggleTarget(alias, groupIdx, targetIdx, val)}
                          size="sm"
                          disabled={isProviderDisabled}
                        />
                        <div className="flex-1 truncate" title={`${t.provider} → ${t.model}`}>
                          {t.provider} →{' '}
                          {t.model?.includes('/')
                            ? `…/${t.model.split('/').slice(1).join('/')}`
                            : t.model}
                        </div>
                      </div>
                      {testState?.showMessage && testState.message && (
                        <div className="mt-1">
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              onDismissTestMessage(testKey);
                            }}
                            className={`cursor-pointer rounded border px-2 py-1 ${
                              testState.result === 'error'
                                ? 'border-danger/30 bg-danger/10'
                                : 'border-success/30 bg-success/10'
                            }`}
                            title="Click to dismiss"
                          >
                            <span
                              className={`text-[11px] italic ${
                                testState.result === 'error' ? 'text-danger' : 'text-success'
                              }`}
                            >
                              {testState.message} [×]
                            </span>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
};
