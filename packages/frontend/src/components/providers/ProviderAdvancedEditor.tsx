import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { Badge } from '../ui/Badge';
import type { Provider } from '../../lib/api';

interface Props {
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  addKV: (field: 'headers' | 'extraBody') => void;
  updateKV: (field: 'headers' | 'extraBody', oldKey: string, newKey: string, value: any) => void;
  removeKV: (field: 'headers' | 'extraBody', key: string) => void;
}

export function ProviderAdvancedEditor({
  editingProvider,
  setEditingProvider,
  addKV,
  updateKV,
  removeKV,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHeadersOpen, setIsHeadersOpen] = useState(false);
  const [isExtraBodyOpen, setIsExtraBodyOpen] = useState(false);

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <span className="font-body text-[13px] font-medium text-text-secondary">Advanced</span>
        {isOpen ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </button>
      {isOpen && (
        <div
          className="px-3 py-3 border-t border-border-glass"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          {/* Discount */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px] sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="font-body text-[11px] font-medium text-text-secondary">
                Discount (%)
                <span className="font-normal text-[10px] text-text-muted ml-1 block">
                  e.g., 10 → pays 90%
                </span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="w-full py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={Math.round((editingProvider.discount ?? 0) * 100)}
                  onChange={(e) => {
                    const clamped = Math.min(100, Math.max(0, Number(e.target.value || '0')));
                    setEditingProvider({ ...editingProvider, discount: clamped / 100 });
                  }}
                />
                <span
                  className="font-body text-[12px] text-text-secondary"
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                  }}
                >
                  %
                </span>
              </div>
            </div>
          </div>

          {/* Custom Headers */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsHeadersOpen(!isHeadersOpen)}
            >
              {isHeadersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[13px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Custom Headers
              </label>
              <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                {Object.keys(editingProvider.headers || {}).length}
              </Badge>
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  addKV('headers');
                  setIsHeadersOpen(true);
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
            {isHeadersOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-deep)',
                }}
              >
                {Object.entries(editingProvider.headers || {}).length === 0 && (
                  <div className="font-body text-[11px] text-text-secondary italic">
                    No custom headers configured.
                  </div>
                )}
                {Object.entries(editingProvider.headers || {}).map(([key, val], idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <Input
                      placeholder="Header Name"
                      value={key}
                      onChange={(e) => updateKV('headers', key, e.target.value, val)}
                      style={{ flex: 1 }}
                    />
                    <Input
                      placeholder="Value"
                      value={typeof val === 'object' ? JSON.stringify(val) : val}
                      onChange={(e) => {
                        const raw = e.target.value;
                        try {
                          updateKV('headers', key, key, JSON.parse(raw));
                        } catch {
                          updateKV('headers', key, key, raw);
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeKV('headers', key)}
                      style={{ padding: '4px' }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Extra Body Fields */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsExtraBodyOpen(!isExtraBodyOpen)}
            >
              {isExtraBodyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[13px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Extra Body Fields
              </label>
              <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                {Object.keys(editingProvider.extraBody || {}).length}
              </Badge>
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  addKV('extraBody');
                  setIsExtraBodyOpen(true);
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
            {isExtraBodyOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-deep)',
                }}
              >
                {Object.entries(editingProvider.extraBody || {}).length === 0 && (
                  <div className="font-body text-[11px] text-text-secondary italic">
                    No extra body fields configured.
                  </div>
                )}
                {Object.entries(editingProvider.extraBody || {}).map(([key, val], idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <Input
                      placeholder="Field Name"
                      value={key}
                      onChange={(e) => updateKV('extraBody', key, e.target.value, val)}
                      style={{ flex: 1 }}
                    />
                    <Input
                      placeholder="Value"
                      value={typeof val === 'object' ? JSON.stringify(val) : val}
                      onChange={(e) => {
                        const raw = e.target.value;
                        try {
                          updateKV('extraBody', key, key, JSON.parse(raw));
                        } catch {
                          updateKV('extraBody', key, key, raw);
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeKV('extraBody', key)}
                      style={{ padding: '4px' }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Estimate Tokens */}
          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle">
            <div className="flex items-center gap-2" style={{ minHeight: '38px' }}>
              <Switch
                checked={editingProvider.estimateTokens || false}
                onChange={(checked) =>
                  setEditingProvider({ ...editingProvider, estimateTokens: checked })
                }
              />
              <label
                className="font-body text-[13px] font-medium text-text"
                style={{ marginBottom: 0 }}
              >
                Estimate Tokens
              </label>
            </div>
            <div
              className="font-body text-[11px] text-text-secondary"
              style={{ lineHeight: 1.35, marginTop: '4px' }}
            >
              Enable token estimation only when a provider does not return usage data.
              <span className="text-warning" style={{ marginLeft: '6px' }}>
                Use sparingly—this is rarely needed.
              </span>
            </div>
          </div>

          {/* Disable Cooldown */}
          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle">
            <div className="flex items-center gap-2" style={{ minHeight: '38px' }}>
              <Switch
                checked={editingProvider.disableCooldown || false}
                onChange={(checked) =>
                  setEditingProvider({ ...editingProvider, disableCooldown: checked })
                }
              />
              <label
                className="font-body text-[13px] font-medium text-text"
                style={{ marginBottom: 0 }}
              >
                Disable Cooldowns
              </label>
            </div>
            <div
              className="font-body text-[11px] text-text-secondary"
              style={{ lineHeight: 1.35, marginTop: '4px' }}
            >
              When enabled, this provider will never be placed on cooldown.
              <span className="text-warning" style={{ marginLeft: '6px' }}>
                Use only for providers with reliable external rate-limit handling.
              </span>
            </div>
          </div>

          {/* Use Claude Masking */}
          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle">
            <div className="flex items-center gap-2" style={{ minHeight: '38px' }}>
              <Switch
                checked={editingProvider.useClaudeMasking || false}
                onChange={(checked) =>
                  setEditingProvider({ ...editingProvider, useClaudeMasking: checked })
                }
              />
              <label
                className="font-body text-[13px] font-medium text-text"
                style={{ marginBottom: 0 }}
              >
                Use Claude Masking
              </label>
            </div>
            <div
              className="font-body text-[11px] text-text-secondary"
              style={{ lineHeight: 1.35, marginTop: '4px' }}
            >
              When enabled, requests to this Anthropic provider will be masked as Claude Code CLI
              sessions.
              <span className="text-warning" style={{ marginLeft: '6px' }}>
                Only effective for Anthropic providers.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
