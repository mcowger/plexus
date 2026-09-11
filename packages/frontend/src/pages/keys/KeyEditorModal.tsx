import type { Dispatch, SetStateAction } from 'react';
import { RefreshCw } from 'lucide-react';
import type { KeyConfig } from '../../lib/api';
import { Input } from '../../components/ui/Input';
import { TagSelect } from '../../components/ui/TagSelect';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Switch } from '../../components/ui/Switch';
import { formatExpiry } from './helpers';
import type { ExpiryUnit } from './types';

interface KeyEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingKey: KeyConfig;
  setEditingKey: Dispatch<SetStateAction<KeyConfig>>;
  originalKeyName: string | null;
  isSaving: boolean;
  onSave: () => void;
  onGenerate: () => void;
  expiryAmount: string;
  setExpiryAmount: (value: string) => void;
  expiryUnit: ExpiryUnit;
  setExpiryUnit: (value: ExpiryUnit) => void;
  aliasIds: string[];
  providerIds: string[];
  quotaNames: string[];
}

export const KeyEditorModal = ({
  isOpen,
  onClose,
  editingKey,
  setEditingKey,
  originalKeyName,
  isSaving,
  onSave,
  onGenerate,
  expiryAmount,
  setExpiryAmount,
  expiryUnit,
  setExpiryUnit,
  aliasIds,
  providerIds,
  quotaNames,
}: KeyEditorModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={originalKeyName ? 'Edit Key' : 'Add Key'}
    size="md"
    footer={
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={onSave}
          isLoading={isSaving}
          disabled={!editingKey.key || !editingKey.secret}
        >
          Save Key
        </Button>
      </div>
    }
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex flex-col gap-2">
        <Input
          label="Key Name (ID)"
          value={editingKey.key}
          onChange={(event) => setEditingKey({ ...editingKey, key: event.target.value })}
          placeholder="e.g. production-app-1"
          disabled={!!originalKeyName}
        />
        <p className="text-xs text-text-muted">
          {originalKeyName
            ? 'Key ID cannot be changed once created.'
            : 'A unique identifier for this key.'}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-body text-[13px] font-medium text-text-secondary">Secret Key</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <Input
              value={editingKey.secret}
              onChange={(event) => setEditingKey({ ...editingKey, secret: event.target.value })}
              placeholder="sk-..."
              type="password"
            />
          </div>
          <Button
            variant="secondary"
            onClick={onGenerate}
            title="Generate new key"
            className="w-full sm:w-auto"
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          The secret used to authenticate. Click refresh to generate a secure random key.
        </p>
      </div>

      <Input
        label="Comment"
        value={editingKey.comment || ''}
        onChange={(event) => setEditingKey({ ...editingKey, comment: event.target.value })}
        placeholder="Optional description..."
      />

      {originalKeyName ? (
        editingKey.expiresAt && (
          <div className="rounded-md border border-border-glass bg-bg-subtle p-3 text-sm text-text-secondary">
            <div>Expires: {formatExpiry(editingKey.expiresAt)}</div>
            <p className="mt-1 text-xs text-text-muted">Expiry cannot be changed after creation.</p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <label className="font-body text-[13px] font-medium text-text-secondary">
            Expiry (optional)
          </label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              step={1}
              value={expiryAmount}
              onChange={(event) => setExpiryAmount(event.target.value)}
              placeholder="Never expires"
            />
            <select
              className="rounded-md border border-border-glass bg-bg-subtle px-3 text-sm text-text"
              value={expiryUnit}
              onChange={(event) => setExpiryUnit(event.target.value as ExpiryUnit)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
          <p className="text-xs text-text-muted">
            Once set, a time-bound key cannot be extended or re-enabled.
          </p>
        </div>
      )}

      <TagSelect
        label="Excluded Model Aliases"
        placeholder="Optional: select model aliases to exclude..."
        options={aliasIds}
        selected={editingKey.excludedModels || []}
        onChange={(excludedModels) =>
          setEditingKey({
            ...editingKey,
            excludedModels: excludedModels.length > 0 ? excludedModels : undefined,
          })
        }
      />
      <p className="text-xs text-text-muted -mt-1">
        Optional denylist. If set, this key cannot use these model aliases.
      </p>

      <TagSelect
        label="Allowed Model Aliases"
        placeholder="Optional: select model aliases..."
        options={aliasIds}
        selected={editingKey.allowedModels || []}
        onChange={(allowedModels) =>
          setEditingKey({
            ...editingKey,
            allowedModels: allowedModels.length > 0 ? allowedModels : undefined,
          })
        }
      />
      <p className="text-xs text-text-muted -mt-1">
        Optional allowlist. If set, this key can only use these configured model aliases.
      </p>

      <TagSelect
        label="Excluded Providers"
        placeholder="Optional: select providers to exclude..."
        options={providerIds}
        selected={editingKey.excludedProviders || []}
        onChange={(excludedProviders) =>
          setEditingKey({
            ...editingKey,
            excludedProviders: excludedProviders.length > 0 ? excludedProviders : undefined,
          })
        }
      />
      <p className="text-xs text-text-muted -mt-1">
        Optional denylist. If set, routing will not use these provider IDs.
      </p>

      <TagSelect
        label="Allowed Providers"
        placeholder="Optional: select providers..."
        options={providerIds}
        selected={editingKey.allowedProviders || []}
        onChange={(allowedProviders) =>
          setEditingKey({
            ...editingKey,
            allowedProviders: allowedProviders.length > 0 ? allowedProviders : undefined,
          })
        }
      />
      <p className="text-xs text-text-muted -mt-1">
        Optional allowlist. If set, routing is limited to these provider IDs.
      </p>

      <label className="flex items-start gap-2 py-1 cursor-pointer">
        <Switch
          checked={editingKey.allowRawPassthrough === true}
          onChange={(allowRawPassthrough) => setEditingKey({ ...editingKey, allowRawPassthrough })}
        />
        <div>
          <div className="font-body text-[13px] text-text">Allow Raw Provider Access</div>
          <div className="text-xs text-text-muted" style={{ lineHeight: 1.35 }}>
            Privileged capability. This key may call any endpoint on raw-enabled providers permitted
            by its provider allow/deny lists. Model restrictions do not apply.
          </div>
        </div>
      </label>

      <TagSelect
        label="Allowed IPs"
        placeholder="e.g. 192.168.1.10  10.0.0.0/8  10.1.0.10-20"
        options={[]}
        selected={editingKey.allowedIps || []}
        allowCustom
        splitOnSpace
        onChange={(allowedIps) =>
          setEditingKey({
            ...editingKey,
            allowedIps: allowedIps.length > 0 ? allowedIps : undefined,
          })
        }
      />
      <p className="text-xs text-text-muted -mt-1">
        Optional allowlist. Type entries separated by spaces. Empty means allow all;{' '}
        <code>0.0.0.0/0</code> is all IPv4 and <code>::/0</code> all IPv6. Accepts IPv4/IPv6, CIDR
        (e.g. <code>10.0.0.0/8</code>), and ranges (e.g. <code>10.1.0.10-20</code>).
      </p>

      <TagSelect
        label="Quota Assignment"
        placeholder="No quotas — falls back to default quotas, if any..."
        options={quotaNames}
        selected={editingKey.quotas || []}
        onChange={(names) =>
          setEditingKey({ ...editingKey, quotas: names.length > 0 ? names : undefined })
        }
      />
      <p className="text-xs text-text-muted -mt-1">
        Optional: assign one or more quotas to this key (usage against each is tracked
        independently). When left empty, this key falls back to the system's default quotas, if any
        are configured.
      </p>
    </div>
  </Modal>
);
