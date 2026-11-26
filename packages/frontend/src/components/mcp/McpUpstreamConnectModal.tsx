import { useState } from 'react';

import { Button } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface Props {
  callbackUrl: string;
  provider: 'google' | 'other';
  isBusy: boolean;
  onClose: () => void;
  onContinue: (client: { clientId: string; clientSecret?: string }) => void;
}

export function McpUpstreamConnectModal({
  callbackUrl,
  provider,
  isBusy,
  onClose,
  onContinue,
}: Props) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const isGoogle = provider === 'google';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Connect MCP server"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            isLoading={isBusy}
            disabled={!clientId.trim() || (isGoogle && !clientSecret)}
            onClick={() =>
              onContinue({ clientId: clientId.trim(), ...(clientSecret ? { clientSecret } : {}) })
            }
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-text-secondary text-sm">
          {isGoogle ? (
            <>
              Create a <strong>Web application</strong> OAuth client in Google Cloud. Select{' '}
              <strong>Use this client for an AI-powered agent</strong> and register the callback URL
              below.
            </>
          ) : (
            'Register an OAuth client with the provider using the callback URL below.'
          )}
        </p>
        <div>
          <div className="text-text-secondary text-sm font-medium">Callback URL</div>
          <div className="flex items-center gap-2">
            <code className="text-text min-w-0 text-sm break-all">{callbackUrl}</code>
            <CopyButton value={callbackUrl} label="Copy callback URL" />
          </div>
        </div>
        <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <Input
          label={isGoogle ? 'Client secret' : 'Client secret (optional)'}
          type="password"
          autoComplete="new-password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
    </Modal>
  );
}
