import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { Provider, OAuthSession } from '../../lib/api';
import type { OAuthCredentialStatus } from '../../types/settings';
import { formatResetsIn, formatTimeAgo } from '../../lib/format';

function describeAge(epochMs: number, nowMs: number): string {
  return formatTimeAgo(Math.max(0, Math.floor((nowMs - epochMs) / 1000)));
}

/**
 * "connected 1d ago · key refreshed 3m ago · expires in 23h 12m" — makes a
 * stale or soon-expiring login visible without opening the database.
 */
function describeCredentialAge(status: OAuthCredentialStatus, nowMs: number): string | null {
  const parts: string[] = [];
  if (status.connectedAt) parts.push(`connected ${describeAge(status.connectedAt, nowMs)}`);
  if (status.refreshedAt && status.refreshedAt !== status.connectedAt) {
    parts.push(`key refreshed ${describeAge(status.refreshedAt, nowMs)}`);
  }
  if (status.expiresAt) {
    parts.push(
      status.expiresAt <= nowMs
        ? 'key expired'
        : `expires ${formatResetsIn(new Date(status.expiresAt).toISOString())}`
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function describeCredentialDates(status: OAuthCredentialStatus): string {
  const line = (label: string, epochMs?: number) =>
    epochMs ? `${label}: ${new Date(epochMs).toLocaleString()}` : null;
  return [
    line('Connected', status.connectedAt),
    line('Key refreshed', status.refreshedAt),
    line('Expires', status.expiresAt),
  ]
    .filter(Boolean)
    .join('\n');
}

interface Props {
  editingProvider: Provider;
  oauthSession: OAuthSession | null;
  oauthSessionId: string | null;
  oauthPromptValue: string;
  setOauthPromptValue: (v: string) => void;
  oauthManualCode: string;
  setOauthManualCode: (v: string) => void;
  oauthError: string | null;
  oauthBusy: boolean;
  oauthCredentialReady: boolean;
  oauthCredentialChecking: boolean;
  /** Credential age for the status line; null until a ready credential is found. */
  oauthCredentialStatus?: OAuthCredentialStatus | null;
  oauthStatus: string | undefined;
  oauthIsTerminal: boolean;
  oauthStatusLabel: string;
  onStart: () => Promise<void>;
  onSubmitPrompt: () => Promise<void>;
  onSubmitManualCode: () => Promise<void>;
  onCancel: () => Promise<void>;
  onDeleteCredential: () => Promise<void>;
}

export function ProviderOAuthEditor({
  editingProvider: _editingProvider,
  oauthSession,
  oauthSessionId,
  oauthPromptValue,
  setOauthPromptValue,
  oauthManualCode,
  setOauthManualCode,
  oauthError,
  oauthBusy,
  oauthCredentialReady,
  oauthCredentialChecking,
  oauthCredentialStatus,
  oauthStatus,
  oauthIsTerminal,
  oauthStatusLabel,
  onStart,
  onSubmitPrompt,
  onSubmitManualCode,
  onCancel,
  onDeleteCredential,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const hasActiveSession = !!oauthSessionId && !oauthIsTerminal;
  const showDelete = oauthCredentialReady && !hasActiveSession;
  const credentialAge =
    oauthCredentialReady && !hasActiveSession && oauthCredentialStatus
      ? describeCredentialAge(oauthCredentialStatus, Date.now())
      : null;

  const handleDeleteClick = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    await onDeleteCredential();
  };
  return (
    <div
      className="border border-border-glass rounded-md p-3 bg-bg-subtle"
      style={{ marginTop: '4px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '8px',
        }}
      >
        <div>
          <div className="font-body text-[13px] font-medium text-text">OAuth Authentication</div>
          <div className="text-[11px] text-text-secondary">
            Tokens are stored securely on the server after login.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background:
                oauthStatus === 'success' || (!oauthStatus && oauthCredentialReady)
                  ? 'var(--color-success)'
                  : oauthStatus === 'error' || oauthStatus === 'cancelled'
                    ? 'var(--color-danger)'
                    : 'var(--color-text-secondary)',
              opacity: oauthCredentialChecking ? 0.6 : 1,
            }}
          />
          <span
            className="text-[11px] font-medium text-text-secondary"
            style={{ textTransform: 'lowercase' }}
          >
            {oauthStatusLabel}
          </span>
        </div>
      </div>

      {credentialAge && oauthCredentialStatus && (
        <div
          className="text-[11px] text-text-secondary"
          style={{ marginBottom: '8px' }}
          title={describeCredentialDates(oauthCredentialStatus)}
        >
          {credentialAge}
        </div>
      )}

      {oauthError && (
        <div className="text-[11px] text-danger" style={{ marginBottom: '8px' }}>
          {oauthError}
        </div>
      )}

      {oauthSession?.authInfo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
          <Input label="Authorization URL" value={oauthSession.authInfo.url} readOnly />
          {oauthSession.authInfo.instructions && (
            <div className="text-[11px] text-text-secondary flex items-center gap-1">
              <Info size={12} />
              <span>{oauthSession.authInfo.instructions}</span>
            </div>
          )}
        </div>
      )}

      {oauthSession?.prompt && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              label={oauthSession.prompt.message}
              placeholder={oauthSession.prompt.placeholder}
              value={oauthPromptValue}
              onChange={(e) => setOauthPromptValue(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={onSubmitPrompt}
            disabled={oauthBusy || (!oauthSession.prompt.allowEmpty && !oauthPromptValue)}
          >
            Submit
          </Button>
        </div>
      )}

      {oauthStatus === 'awaiting_manual_code' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Paste redirect URL or code"
              value={oauthManualCode}
              onChange={(e) => setOauthManualCode(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <Button size="sm" onClick={onSubmitManualCode} disabled={oauthBusy || !oauthManualCode}>
            Submit
          </Button>
        </div>
      )}

      {oauthSession?.progress && oauthSession.progress.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div className="text-[11px] text-text-secondary">Progress</div>
          <div className="text-[11px] text-text" style={{ marginTop: '4px' }}>
            {(oauthSession.progress ?? []).slice(-3).map((message, idx) => (
              <div key={`${message}-${idx}`}>{message}</div>
            ))}
          </div>
        </div>
      )}

      {oauthStatus === 'success' && (
        <div className="text-[11px] text-success" style={{ marginBottom: '8px' }}>
          Authentication complete. Tokens stored securely on the server.
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={onStart}
          isLoading={oauthBusy && !oauthSessionId}
          disabled={oauthBusy || (!!oauthSessionId && !oauthIsTerminal)}
        >
          {oauthSessionId && !oauthIsTerminal
            ? 'OAuth in progress'
            : oauthCredentialReady
              ? 'Restart OAuth'
              : 'Start OAuth'}
        </Button>
        {oauthSessionId && !oauthIsTerminal && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={oauthBusy}>
            Cancel
          </Button>
        )}
        {showDelete && (
          <Button
            size="sm"
            variant={confirmingDelete ? 'danger' : 'ghost'}
            onClick={handleDeleteClick}
            disabled={oauthBusy}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? 'Confirm remove' : 'Remove credentials'}
          </Button>
        )}
      </div>
    </div>
  );
}
