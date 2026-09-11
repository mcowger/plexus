import type { Dispatch, SetStateAction } from 'react';
import type { UserQuota } from '../../lib/api';
import { Input } from '../../components/ui/Input';
import { TagSelect } from '../../components/ui/TagSelect';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Switch } from '../../components/ui/Switch';
import type { EditingQuota } from './types';

interface QuotaEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingQuota: EditingQuota;
  setEditingQuota: Dispatch<SetStateAction<EditingQuota>>;
  originalQuotaName: string | null;
  isSaving: boolean;
  onSave: () => void;
  providerIds: string[];
  allModelNames: string[];
  symbol: string;
}

export const QuotaEditorModal = ({
  isOpen,
  onClose,
  editingQuota,
  setEditingQuota,
  originalQuotaName,
  isSaving,
  onSave,
  providerIds,
  allModelNames,
  symbol,
}: QuotaEditorModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={originalQuotaName ? 'Edit Quota' : 'Add Quota'}
    size="md"
    footer={
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onSave} isLoading={isSaving} disabled={!editingQuota.name}>
          Save Quota
        </Button>
      </div>
    }
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex flex-col gap-2">
        <Input
          label="Quota Name"
          value={editingQuota.name}
          onChange={(event) => setEditingQuota({ ...editingQuota, name: event.target.value })}
          placeholder="e.g. daily-1000"
          disabled={!!originalQuotaName}
        />
        <p className="text-xs text-text-muted">
          {originalQuotaName
            ? 'Quota name cannot be changed once created.'
            : 'A unique identifier for this quota. Use lowercase letters, numbers, hyphens.'}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-body text-[13px] font-medium text-text-secondary">Quota Type</label>
        <select
          className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
          value={editingQuota.type}
          onChange={(event) =>
            setEditingQuota({ ...editingQuota, type: event.target.value as UserQuota['type'] })
          }
        >
          <option value="rolling">Rolling Window</option>
          <option value="daily">Daily (UTC)</option>
          <option value="weekly">Weekly (UTC)</option>
          <option value="monthly">Monthly (UTC)</option>
        </select>
        <p className="text-xs text-text-muted">
          {editingQuota.type === 'rolling' && 'Limits usage over a sliding time window'}
          {editingQuota.type === 'daily' && 'Resets at midnight UTC each day'}
          {editingQuota.type === 'weekly' && 'Resets at midnight UTC on Monday'}
          {editingQuota.type === 'monthly' && 'Resets at midnight UTC on the 1st of each month'}
        </p>
      </div>

      {editingQuota.type === 'rolling' && (
        <div className="flex flex-col gap-2">
          <Input
            label="Duration"
            value={editingQuota.duration || ''}
            onChange={(event) => setEditingQuota({ ...editingQuota, duration: event.target.value })}
            placeholder="e.g. 1h, 30m, 1d"
          />
          <p className="text-xs text-text-muted">
            Duration of the rolling window (e.g., 1h, 30m, 2h30m, 1d)
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="font-body text-[13px] font-medium text-text-secondary">Limit Type</label>
        <select
          className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
          value={editingQuota.limitType}
          onChange={(event) =>
            setEditingQuota({
              ...editingQuota,
              limitType: event.target.value as UserQuota['limitType'],
            })
          }
        >
          <option value="requests">Requests</option>
          <option value="tokens">Tokens</option>
          <option value="cost">Cost ({symbol})</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Input
          label="Limit"
          type="number"
          value={editingQuota.limit}
          onChange={(event) =>
            setEditingQuota({ ...editingQuota, limit: parseInt(event.target.value) || 0 })
          }
          placeholder="1000"
        />
        <p className="text-xs text-text-muted">
          Maximum {editingQuota.limitType === 'cost' ? `cost (${symbol})` : editingQuota.limitType}{' '}
          allowed
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border-glass bg-bg-subtle p-3">
        <div className="min-w-0 flex-1">
          <div className="font-body text-[13px] font-medium text-text-secondary">Shared bucket</div>
          <p className="mt-1 text-xs text-text-muted">
            Pool usage across every key that references this quota into a single counter, instead of
            tracking each key independently.
          </p>
        </div>
        <Switch
          checked={!!editingQuota.shared}
          onChange={(shared) => setEditingQuota({ ...editingQuota, shared })}
          aria-label="Toggle shared quota bucket"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Input
          label="Warn threshold (optional)"
          type="number"
          min={1}
          max={99}
          value={editingQuota.warnAt !== undefined ? Math.round(editingQuota.warnAt * 100) : ''}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              setEditingQuota({ ...editingQuota, warnAt: undefined });
              return;
            }
            const pct = parseInt(raw, 10);
            if (Number.isNaN(pct)) return;
            setEditingQuota({
              ...editingQuota,
              warnAt: Math.min(99, Math.max(1, pct)) / 100,
            });
          }}
          placeholder="e.g. 80"
        />
        <p className="text-xs text-text-muted">
          Percent of the limit at which to flag usage as approaching exhaustion. Leave empty to
          disable early-warning.
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t border-border-glass">
        <p className="text-xs font-medium text-text-secondary">
          Scope (optional — unscoped applies to every provider/model)
        </p>
      </div>

      <TagSelect
        label="Allowed Providers"
        placeholder="Optional: restrict to these providers..."
        options={providerIds}
        selected={editingQuota.allowedProviders || []}
        onChange={(allowedProviders) => setEditingQuota({ ...editingQuota, allowedProviders })}
      />
      <TagSelect
        label="Excluded Providers"
        placeholder="Optional: exclude these providers..."
        options={providerIds}
        selected={editingQuota.excludedProviders || []}
        onChange={(excludedProviders) => setEditingQuota({ ...editingQuota, excludedProviders })}
      />
      <TagSelect
        label="Allowed Models"
        placeholder="Optional: restrict to these models..."
        options={allModelNames}
        selected={editingQuota.allowedModels || []}
        allowCustom
        onChange={(allowedModels) => setEditingQuota({ ...editingQuota, allowedModels })}
      />
      <TagSelect
        label="Excluded Models"
        placeholder="Optional: exclude these models..."
        options={allModelNames}
        selected={editingQuota.excludedModels || []}
        allowCustom
        onChange={(excludedModels) => setEditingQuota({ ...editingQuota, excludedModels })}
      />
      <p className="text-xs text-text-muted -mt-1">
        Only requests matching the allowed/not-excluded provider and model count against this quota.
        Model names accept free-typing since not every model is synced into a provider's catalog
        yet.
      </p>
    </div>
  </Modal>
);
