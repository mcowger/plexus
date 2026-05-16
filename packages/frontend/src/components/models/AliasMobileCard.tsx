import React from 'react';
import { Trash2, Loader2, CheckCircle, AlertTriangle, Play } from 'lucide-react';
import { CopyButton } from '../ui/CopyButton';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { ModelTypeBadge } from './ModelTypeBadge';
import type { Alias, Provider, Cooldown } from '../../lib/api';
import { useT } from '../../i18n';

interface Props {
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
    provider: string,
    model: string,
    types: string[]
  ) => void;
  onDismissTestMessage: (testKey: string) => void;
}

export const AliasMobileCard: React.FC<Props> = ({
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
  const { t } = useT('models.aliasMobileCard');
  const { t: tm } = useT('models.modal');

  const priorityKey = alias.priority || 'selector';
  const priorityLabel =
    priorityKey === 'api_match' ? tm('priorities.apiMatch') : tm('priorities.selector');

  return (
    <article key={alias.id} className="rounded-md border border-border-glass bg-bg-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onEdit(alias)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <div className="truncate font-heading text-sm font-semibold text-text">{alias.id}</div>
            <CopyButton value={alias.id} size="sm" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ModelTypeBadge type={alias.type} />
            {alias.metadata && (
              <span className="inline-flex rounded border border-border-glass px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                {alias.metadata.source}
              </span>
            )}
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(alias)}
          className="text-danger"
          aria-label={t('deleteAria', { id: alias.id })}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">{t('selectorSection')}</div>
          <div className="truncate font-medium capitalize text-text-secondary">
            {alias.target_groups.map((g) => `${g.name}: ${g.selector}`).join(', ')} / {priorityLabel}
          </div>
        </div>
        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">{t('aliasesSection')}</div>
          <div className="flex flex-wrap gap-1 font-medium text-text-secondary">
            {alias.aliases?.length
              ? alias.aliases.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1">
                    <span className="text-xs">{a}</span>
                    <CopyButton value={a} size="sm" />
                  </span>
                ))
              : '-'}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          <span>{t('targetsHeading')}</span>
          {alias.target_groups[0] && (
            <>
              <span className="opacity-40 normal-case">
                direct/{alias.id}/{alias.target_groups[0].name}
              </span>
              <CopyButton value={`direct/${alias.id}/${alias.target_groups[0].name}`} size="sm" />
            </>
          )}
        </div>
        {alias.target_groups.length === 0 || alias.target_groups[0].targets.length === 0 ? (
          <div className="rounded border border-border-glass bg-bg-glass px-2 py-2 text-xs italic text-text-muted">
            {t('noTargets')}
          </div>
        ) : (
          <div className="space-y-2">
            {alias.target_groups[0].targets.map((tgt, i) => {
              const provider = providers.find((p) => p.id === tgt.provider);
              const isProviderDisabled = provider?.enabled === false;
              const isTargetDisabled = tgt.enabled === false;
              const isDisabled = isProviderDisabled || isTargetDisabled;
              const testKey = `${alias.id}-mobile-${i}`;
              const testState = testStates[testKey];
              const cooldown = cooldowns.find(
                (c) => c.provider === tgt.provider && c.model === tgt.model && !c.accountId
              );
              const cooldownMinutes = cooldown ? Math.ceil(cooldown.timeRemainingMs / 60000) : 0;

              return (
                <div
                  key={`${tgt.provider}-${tgt.model}-${i}`}
                  className={`rounded border border-border-glass bg-bg-glass px-2 py-2 ${
                    isDisabled ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-xs font-medium ${
                          isDisabled ? 'text-danger line-through' : 'text-text-secondary'
                        }`}
                      >
                        {tgt.provider || t('noProvider')} <span className="text-text-muted">-&gt;</span>{' '}
                        {tgt.model || t('noModel')}
                      </div>
                      {isProviderDisabled && (
                        <div className="mt-1 text-[11px] text-danger">{t('providerDisabled')}</div>
                      )}
                      {cooldown && (
                        <div className="mt-1 text-[11px] font-medium text-warning">
                          {t('cooldownMinutes', { count: cooldownMinutes })}
                        </div>
                      )}
                      {testState?.showResult && testState.message && (
                        <div
                          className={`mt-1 text-[11px] italic ${
                            testState.result === 'success' ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {testState.message}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (isDisabled) return;
                          let testApiTypes: string[] = ['chat'];
                          if (alias.type === 'embeddings') testApiTypes = ['embeddings'];
                          else if (alias.type === 'image') testApiTypes = ['images'];
                          else if (alias.type === 'responses') testApiTypes = ['responses'];

                          onTestTarget(
                            alias.id,
                            `${alias.id}-mobile-${i}`,
                            tgt.provider,
                            tgt.model,
                            testApiTypes
                          );
                        }}
                        disabled={isDisabled}
                        className="flex h-7 w-7 items-center justify-center rounded text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t('testTargetAria', { aliasId: alias.id, index: i + 1 })}
                      >
                        {testState?.loading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : testState?.showResult && testState.result === 'success' ? (
                          <CheckCircle size={14} className="text-success" />
                        ) : testState?.showResult && testState.result === 'error' ? (
                          <AlertTriangle size={14} className="text-danger" />
                        ) : (
                          <Play size={14} />
                        )}
                      </button>
                      <Switch
                        checked={tgt.enabled !== false}
                        onChange={(val) => onToggleTarget(alias, 0, i, val)}
                        size="sm"
                        disabled={isProviderDisabled}
                      />
                    </div>
                  </div>
                  {testState?.showMessage && testState.result === 'error' && testState.message && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismissTestMessage(testKey);
                      }}
                      className="mt-2 cursor-pointer rounded border border-danger/30 bg-danger/10 px-2 py-1"
                      title={t('dismissErrorTitle')}
                    >
                      <span className="text-[11px] italic text-danger">
                        {testState.message} [×]
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
};
