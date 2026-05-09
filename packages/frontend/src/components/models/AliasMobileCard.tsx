import React from 'react';
import { Trash2, Loader2, CheckCircle, AlertTriangle, Play } from 'lucide-react';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { ModelTypeBadge } from './ModelTypeBadge';
import type { Alias, Provider, Cooldown } from '../../lib/api';

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
  return (
    <article key={alias.id} className="rounded-md border border-border-glass bg-bg-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onEdit(alias)} className="min-w-0 flex-1 text-left">
          <div className="truncate font-heading text-sm font-semibold text-text">{alias.id}</div>
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
          aria-label={`Delete ${alias.id}`}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Selector</div>
          <div className="truncate font-medium capitalize text-text-secondary">
            {alias.target_groups.map((g) => `${g.name}: ${g.selector}`).join(', ')} /{' '}
            {alias.priority || 'selector'}
          </div>
        </div>
        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Aliases</div>
          <div className="truncate font-medium text-text-secondary">
            {alias.aliases?.length ? alias.aliases.join(', ') : '-'}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Targets
        </div>
        {alias.target_groups.length === 0 || alias.target_groups[0].targets.length === 0 ? (
          <div className="rounded border border-border-glass bg-bg-glass px-2 py-2 text-xs italic text-text-muted">
            No targets configured
          </div>
        ) : (
          <div className="space-y-2">
            {alias.target_groups[0].targets.map((t, i) => {
              const provider = providers.find((p) => p.id === t.provider);
              const isProviderDisabled = provider?.enabled === false;
              const isTargetDisabled = t.enabled === false;
              const isDisabled = isProviderDisabled || isTargetDisabled;
              const testKey = `${alias.id}-${i}`;
              const testState = testStates[testKey];
              const cooldown = cooldowns.find(
                (c) => c.provider === t.provider && c.model === t.model && !c.accountId
              );
              const cooldownMinutes = cooldown ? Math.ceil(cooldown.timeRemainingMs / 60000) : 0;

              return (
                <div
                  key={`${t.provider}-${t.model}-${i}`}
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
                        {t.provider || 'No provider'} <span className="text-text-muted">-&gt;</span>{' '}
                        {t.model || 'No model'}
                      </div>
                      {isProviderDisabled && (
                        <div className="mt-1 text-[11px] text-danger">Provider disabled</div>
                      )}
                      {cooldown && (
                        <div className="mt-1 text-[11px] font-medium text-warning">
                          Cooldown {cooldownMinutes}m
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
                            t.provider,
                            t.model,
                            testApiTypes
                          );
                        }}
                        disabled={isDisabled}
                        className="flex h-7 w-7 items-center justify-center rounded text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Test ${alias.id} target ${i + 1}`}
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
                        checked={t.enabled !== false}
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
                      title="Click to dismiss"
                    >
                      <span className="text-[11px] italic text-danger">{testState.message} [×]</span>
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
