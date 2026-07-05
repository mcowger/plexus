import React from 'react';

/** Small pill used to label quota scope/source facts (shared, default,
 * scoped) across the Keys list rows, the quota status modal, and the shared
 * QuotaStatusCard. */
export const QuotaChip: React.FC<{ children: React.ReactNode; tone?: 'default' | 'muted' }> = ({
  children,
  tone = 'default',
}) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-md ${
      tone === 'muted'
        ? 'bg-bg-subtle text-text-muted border border-border-glass'
        : 'bg-primary/10 text-primary border border-primary/20'
    }`}
  >
    {children}
  </span>
);

/** The four optional scope-narrowing lists shared by quota status entries
 * (`QuotaStatusEntry['scope']`) and quota definitions (`UserQuota`). */
export interface QuotaScopeFields {
  allowedProviders?: string[];
  excludedProviders?: string[];
  allowedModels?: string[];
  excludedModels?: string[];
}

/** Whether a quota's scope narrows it to specific providers/models. */
export function hasScope(scope: QuotaScopeFields | undefined): boolean {
  if (!scope) return false;
  return Boolean(
    scope.allowedProviders?.length ||
      scope.excludedProviders?.length ||
      scope.allowedModels?.length ||
      scope.excludedModels?.length
  );
}
