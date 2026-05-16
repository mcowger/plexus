import { Info } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { Provider, OAuthSession } from '../../lib/api';
import { useT } from '../../i18n/useT';

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
  oauthStatus: string | undefined;
  oauthIsTerminal: boolean;
  oauthStatusLabel: string;
  onStart: () => Promise<void>;
  onSubmitPrompt: () => Promise<void>;
  onSubmitManualCode: () => Promise<void>;
  onCancel: () => Promise<void>;
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
  oauthStatus,
  oauthIsTerminal,
  oauthStatusLabel,
  onStart,
  onSubmitPrompt,
  onSubmitManualCode,
  onCancel,
}: Props) {
  const { t } = useT('providers.oauth');
  const { t: tc } = useT('common');
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
          <div className="font-body text-[13px] font-medium text-text">{t('title')}</div>
          <div className="text-[11px] text-text-secondary">{t('tokensHint')}</div>
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

      {oauthError && (
        <div className="text-[11px] text-danger" style={{ marginBottom: '8px' }}>
          {oauthError}
        </div>
      )}

      {oauthSession?.authInfo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
          <Input label={t('authUrl')} value={oauthSession.authInfo.url} readOnly />
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
            {t('submit')}
          </Button>
        </div>
      )}

      {oauthStatus === 'awaiting_manual_code' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              label={t('pasteRedirect')}
              value={oauthManualCode}
              onChange={(e) => setOauthManualCode(e.target.value)}
              placeholder={t('redirectPlaceholder')}
            />
          </div>
          <Button size="sm" onClick={onSubmitManualCode} disabled={oauthBusy || !oauthManualCode}>
            {t('submit')}
          </Button>
        </div>
      )}

      {oauthSession?.progress && oauthSession.progress.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div className="text-[11px] text-text-secondary">{t('progress')}</div>
          <div className="text-[11px] text-text" style={{ marginTop: '4px' }}>
            {(oauthSession.progress ?? []).slice(-3).map((message, idx) => (
              <div key={`${message}-${idx}`}>{message}</div>
            ))}
          </div>
        </div>
      )}

      {oauthStatus === 'success' && (
        <div className="text-[11px] text-success" style={{ marginBottom: '8px' }}>
          {t('complete')}
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
            ? t('inProgress')
            : oauthCredentialReady
              ? t('restart')
              : t('start')}
        </Button>
        {oauthSessionId && !oauthIsTerminal && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={oauthBusy}>
            {tc('cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
