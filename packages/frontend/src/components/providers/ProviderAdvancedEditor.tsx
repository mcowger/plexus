import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { Badge } from '../ui/Badge';
import type { Provider } from '../../lib/api';
import { useT } from '../../i18n/useT';

export const KNOWN_ADAPTER_KEYS = ['reasoning_content', 'suppress_developer_role'] as const;

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
  const { t } = useT('providers.advanced');
  const [isOpen, setIsOpen] = useState(false);
  const [isHeadersOpen, setIsHeadersOpen] = useState(false);
  const [isExtraBodyOpen, setIsExtraBodyOpen] = useState(false);
  const [isStallOpen, setIsStallOpen] = useState(false);

  // Draft state for stall number inputs — allows free typing without
  // range-checking on every keystroke. Values are committed to editingProvider
  // on blur, where we validate the final value.
  const [stallTtfbDraft, setStallTtfbDraft] = useState<string>(
    editingProvider.stallTtfbMs != null
      ? String(Math.round(editingProvider.stallTtfbMs / 1000))
      : ''
  );
  const [stallTtfbBytesDraft, setStallTtfbBytesDraft] = useState<string>(
    editingProvider.stallTtfbBytes != null ? String(editingProvider.stallTtfbBytes) : ''
  );
  const [stallMinBpsDraft, setStallMinBpsDraft] = useState<string>(
    editingProvider.stallMinBps != null ? String(editingProvider.stallMinBps) : ''
  );
  const [stallWindowDraft, setStallWindowDraft] = useState<string>(
    editingProvider.stallWindowMs != null
      ? String(Math.round(editingProvider.stallWindowMs / 1000))
      : ''
  );
  const [stallGraceDraft, setStallGraceDraft] = useState<string>(
    editingProvider.stallGracePeriodMs != null
      ? String(Math.round(editingProvider.stallGracePeriodMs / 1000))
      : ''
  );

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <span className="font-body text-[13px] font-medium text-text-secondary">{t('title')}</span>
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
          {/* Provider Adapters */}
          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle">
            <label className="font-body text-[13px] font-medium text-text-secondary block mb-2">
              {t('adaptersTitle')}
            </label>
            <div
              className="font-body text-[11px] text-text-secondary mb-3"
              style={{ lineHeight: 1.4 }}
            >
              {t('adaptersHint')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {KNOWN_ADAPTER_KEYS.map((adapterKey) => {
                const active = (editingProvider.adapter ?? []).includes(adapterKey);
                return (
                  <label
                    key={adapterKey}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border-glass)',
                      background: active ? 'var(--color-bg-hover)' : 'var(--color-bg-deep)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      style={{ marginTop: '2px', flexShrink: 0 }}
                      onChange={() => {
                        const current = editingProvider.adapter ?? [];
                        const next = active
                          ? current.filter((v) => v !== adapterKey)
                          : [...current, adapterKey];
                        setEditingProvider({ ...editingProvider, adapter: next });
                      }}
                    />
                    <div>
                      <div className="font-body text-[12px] font-medium text-text">
                        {t(`adapters.${adapterKey}.label`)}
                      </div>
                      <div
                        className="font-body text-[11px] text-text-secondary"
                        style={{ lineHeight: 1.35 }}
                      >
                        {t(`adapters.${adapterKey}.description`)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Discount */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px] sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {t('discount')}
                <span className="font-normal text-[10px] text-text-muted ml-1 block">
                  {t('discountHint')}
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

          {/* Timeout Override */}
          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle">
            <div className="flex flex-col gap-1">
              <label className="font-body text-[13px] font-medium text-text">{t('timeoutTitle')}</label>
              <div
                className="font-body text-[11px] text-text-secondary"
                style={{ lineHeight: 1.35, marginBottom: '4px' }}
              >
                {t('timeoutHint')}
              </div>
              <input
                className="w-full max-w-[200px] py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                type="number"
                step="1"
                min="1"
                max="3600"
                placeholder={t('globalDefault')}
                value={
                  editingProvider.timeoutMs != null
                    ? Math.round(editingProvider.timeoutMs / 1000)
                    : ''
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setEditingProvider({ ...editingProvider, timeoutMs: undefined });
                  } else {
                    const seconds = Number(raw);
                    if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600) {
                      setEditingProvider({ ...editingProvider, timeoutMs: seconds * 1000 });
                    }
                  }
                }}
              />
            </div>
          </div>

          {/* Stall Detection Overrides */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsStallOpen(!isStallOpen)}
            >
              {isStallOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[13px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                {t('stallTitle')}
              </label>
              {(editingProvider.stallTtfbMs != null ||
                editingProvider.stallTtfbBytes != null ||
                editingProvider.stallMinBps != null ||
                editingProvider.stallWindowMs != null ||
                editingProvider.stallGracePeriodMs != null) && (
                <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                  {t('customBadge')}
                </Badge>
              )}
            </div>
            {isStallOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-deep)',
                }}
              >
                <div
                  className="font-body text-[11px] text-text-secondary"
                  style={{ lineHeight: 1.35, marginBottom: '2px' }}
                >
                  {t('stallHint')}
                </div>
                {/* TTFB Timeout */}
                <div>
                  <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                    {t('ttfbTimeout')}
                  </label>
                  <div
                    className="font-body text-[10px] text-text-muted"
                    style={{ lineHeight: 1.3, marginBottom: '3px' }}
                  >
                    {t('ttfbTimeoutHint')}
                  </div>
                  <input
                    className="w-full max-w-[200px] py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    placeholder={t('globalDefault')}
                    value={stallTtfbDraft}
                    onChange={(e) => setStallTtfbDraft(e.target.value)}
                    onBlur={() => {
                      const num = Number(stallTtfbDraft);
                      if (stallTtfbDraft === '') {
                        setEditingProvider({ ...editingProvider, stallTtfbMs: undefined });
                      } else if (Number.isFinite(num) && num >= 5 && num <= 120) {
                        setEditingProvider({ ...editingProvider, stallTtfbMs: num * 1000 });
                      } else {
                        // Revert to current value
                        setStallTtfbDraft(
                          editingProvider.stallTtfbMs != null
                            ? String(Math.round(editingProvider.stallTtfbMs / 1000))
                            : ''
                        );
                      }
                    }}
                  />
                </div>
                {/* TTFB Byte Threshold */}
                <div>
                  <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                    {t('ttfbBytes')}
                  </label>
                  <div
                    className="font-body text-[10px] text-text-muted"
                    style={{ lineHeight: 1.3, marginBottom: '3px' }}
                  >
                    {t('ttfbBytesHint')}
                  </div>
                  <input
                    className="w-full max-w-[200px] py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    placeholder={t('globalDefault')}
                    value={stallTtfbBytesDraft}
                    onChange={(e) => setStallTtfbBytesDraft(e.target.value)}
                    onBlur={() => {
                      const num = Number(stallTtfbBytesDraft);
                      if (stallTtfbBytesDraft === '') {
                        setEditingProvider({ ...editingProvider, stallTtfbBytes: undefined });
                      } else if (Number.isFinite(num) && num >= 50 && num <= 10000) {
                        setEditingProvider({ ...editingProvider, stallTtfbBytes: num });
                      } else {
                        setStallTtfbBytesDraft(
                          editingProvider.stallTtfbBytes != null
                            ? String(editingProvider.stallTtfbBytes)
                            : ''
                        );
                      }
                    }}
                  />
                </div>
                {/* Min Bytes/Sec */}
                <div>
                  <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                    {t('minBps')}
                  </label>
                  <div
                    className="font-body text-[10px] text-text-muted"
                    style={{ lineHeight: 1.3, marginBottom: '3px' }}
                  >
                    {t('minBpsHint')}
                  </div>
                  <input
                    className="w-full max-w-[200px] py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    placeholder={t('globalDefault')}
                    value={stallMinBpsDraft}
                    onChange={(e) => setStallMinBpsDraft(e.target.value)}
                    onBlur={() => {
                      const num = Number(stallMinBpsDraft);
                      if (stallMinBpsDraft === '') {
                        setEditingProvider({ ...editingProvider, stallMinBps: undefined });
                      } else if (Number.isFinite(num) && num >= 50 && num <= 5000) {
                        setEditingProvider({ ...editingProvider, stallMinBps: num });
                      } else {
                        setStallMinBpsDraft(
                          editingProvider.stallMinBps != null
                            ? String(editingProvider.stallMinBps)
                            : ''
                        );
                      }
                    }}
                  />
                </div>
                {/* Stall Window */}
                <div>
                  <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                    {t('stallWindow')}
                  </label>
                  <div
                    className="font-body text-[10px] text-text-muted"
                    style={{ lineHeight: 1.3, marginBottom: '3px' }}
                  >
                    {t('stallWindowHint')}
                  </div>
                  <input
                    className="w-full max-w-[200px] py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    placeholder={t('globalDefault')}
                    value={stallWindowDraft}
                    onChange={(e) => setStallWindowDraft(e.target.value)}
                    onBlur={() => {
                      const num = Number(stallWindowDraft);
                      if (stallWindowDraft === '') {
                        setEditingProvider({ ...editingProvider, stallWindowMs: undefined });
                      } else if (Number.isFinite(num) && num >= 3 && num <= 30) {
                        setEditingProvider({ ...editingProvider, stallWindowMs: num * 1000 });
                      } else {
                        setStallWindowDraft(
                          editingProvider.stallWindowMs != null
                            ? String(Math.round(editingProvider.stallWindowMs / 1000))
                            : ''
                        );
                      }
                    }}
                  />
                </div>
                {/* Grace Period */}
                <div>
                  <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                    {t('stallGrace')}
                  </label>
                  <div
                    className="font-body text-[10px] text-text-muted"
                    style={{ lineHeight: 1.3, marginBottom: '3px' }}
                  >
                    {t('stallGraceHint')}
                  </div>
                  <input
                    className="w-full max-w-[200px] py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    placeholder={t('globalDefault')}
                    value={stallGraceDraft}
                    onChange={(e) => setStallGraceDraft(e.target.value)}
                    onBlur={() => {
                      const num = Number(stallGraceDraft);
                      if (stallGraceDraft === '') {
                        setEditingProvider({ ...editingProvider, stallGracePeriodMs: undefined });
                      } else if (Number.isFinite(num) && num >= 0 && num <= 120) {
                        setEditingProvider({ ...editingProvider, stallGracePeriodMs: num * 1000 });
                      } else {
                        setStallGraceDraft(
                          editingProvider.stallGracePeriodMs != null
                            ? String(Math.round(editingProvider.stallGracePeriodMs / 1000))
                            : ''
                        );
                      }
                    }}
                  />
                </div>
              </div>
            )}
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
                {t('headersTitle')}
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
                    {t('noHeaders')}
                  </div>
                )}
                {Object.entries(editingProvider.headers || {}).map(([key, val], idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <Input
                      placeholder={t('headerName')}
                      value={key}
                      onChange={(e) => updateKV('headers', key, e.target.value, val)}
                      style={{ flex: 1 }}
                    />
                    <Input
                      placeholder={t('value')}
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
                {t('extraBodyTitle')}
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
                    {t('noExtraBody')}
                  </div>
                )}
                {Object.entries(editingProvider.extraBody || {}).map(([key, val], idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <Input
                      placeholder={t('fieldName')}
                      value={key}
                      onChange={(e) => updateKV('extraBody', key, e.target.value, val)}
                      style={{ flex: 1 }}
                    />
                    <Input
                      placeholder={t('value')}
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
                {t('estimateTokens')}
              </label>
            </div>
            <div
              className="font-body text-[11px] text-text-secondary"
              style={{ lineHeight: 1.35, marginTop: '4px' }}
            >
              {t('estimateTokensHint')}
              <span className="text-warning" style={{ marginLeft: '6px' }}>
                {t('estimateTokensWarn')}
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
                {t('disableCooldown')}
              </label>
            </div>
            <div
              className="font-body text-[11px] text-text-secondary"
              style={{ lineHeight: 1.35, marginTop: '4px' }}
            >
              {t('disableCooldownHint')}
              <span className="text-warning" style={{ marginLeft: '6px' }}>
                {t('disableCooldownWarn')}
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
                {t('claudeMasking')}
              </label>
            </div>
            <div
              className="font-body text-[11px] text-text-secondary"
              style={{ lineHeight: 1.35, marginTop: '4px' }}
            >
              {t('claudeMaskingHint')}
              <span className="text-warning" style={{ marginLeft: '6px' }}>
                {t('claudeMaskingWarn')}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
