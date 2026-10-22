import { KeyRound, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';

import type { McpOAuthClientRecord } from '../../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface McpOAuthClientsCardProps {
  oauthClients: McpOAuthClientRecord[];
  oauthClientsLoading: boolean;
  revokingTokenId: number | null;
  updatingClientId: string | null;
  deletingClientId: string | null;
  revokingAllClientId: string | null;
  onRefresh: () => void | Promise<void>;
  onRevokeToken: (tokenId: number) => void | Promise<void>;
  onToggleClientStatus: (client: McpOAuthClientRecord) => void | Promise<void>;
  onRevokeAllTokens: (clientId: string) => void | Promise<void>;
  onDeleteClient: (clientId: string) => void | Promise<void>;
}

export function McpOAuthClientsCard({
  oauthClients,
  oauthClientsLoading,
  revokingTokenId,
  updatingClientId,
  deletingClientId,
  revokingAllClientId,
  onRefresh,
  onRevokeToken,
  onToggleClientStatus,
  onRevokeAllTokens,
  onDeleteClient,
}: McpOAuthClientsCardProps) {
  return (
    <Card className="glass-bg flex max-w-full flex-col gap-3 overflow-hidden rounded-lg p-3 shadow-xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-text m-0 mb-1 text-lg font-semibold">
            MCP OAuth Clients
          </h2>
          <p className="text-text-muted text-xs">
            Registered OAuth clients and their active tokens. Tokens show the bound Plexus API key
            name only; raw secrets are never displayed.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          isLoading={oauthClientsLoading}
          leftIcon={<RefreshCw size={14} />}
        >
          Refresh
        </Button>
      </div>

      {oauthClientsLoading ? (
        <div className="text-text-secondary py-8 text-center text-sm">Loading...</div>
      ) : oauthClients.length === 0 ? (
        <div className="border-border-glass bg-bg-subtle text-text-secondary rounded-md border p-4 text-sm">
          No MCP OAuth clients registered yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {oauthClients.map((client) => (
            <article
              key={client.clientId}
              className={`border-border-glass bg-bg-subtle rounded-md border p-3 ${
                client.status === 'disabled' ? 'opacity-60' : ''
              }`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-text flex items-center gap-2 text-sm font-semibold">
                    <KeyRound size={15} className="text-primary" />
                    <span>{client.clientName || 'Unnamed client'}</span>
                    {client.status === 'disabled' ? (
                      <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] tracking-wider text-red-500 uppercase">
                        Disabled
                      </span>
                    ) : (
                      <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] tracking-wider text-emerald-500 uppercase">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-text-secondary mt-1 font-mono text-xs break-all">
                    {client.clientId}
                  </div>
                  <div className="text-text-muted mt-2 text-xs">
                    Created {new Date(client.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="min-w-0 lg:max-w-[45%]">
                  <div className="text-text-muted text-[10px] tracking-wider uppercase">
                    Redirect URIs
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {client.redirectUris.map((uri) => (
                      <code
                        key={uri}
                        className="border-border-glass bg-bg-glass text-text-secondary rounded border px-2 py-1 text-[11px] break-all"
                      >
                        {uri}
                      </code>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-border-glass mt-3 border-t pt-3">
                <div className="text-text-muted mb-2 text-[10px] tracking-wider uppercase">
                  Active tokens
                </div>
                {client.tokens.length === 0 ? (
                  <div className="text-text-muted text-xs">No active tokens for this client.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="font-body w-full border-collapse text-[12px]">
                      <thead>
                        <tr>
                          <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wider uppercase">
                            Key name
                          </th>
                          <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wider uppercase">
                            Scope
                          </th>
                          <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wider uppercase">
                            Access expires
                          </th>
                          <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wider uppercase">
                            Issued
                          </th>
                          <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-2 py-2 text-right text-[10px] font-semibold tracking-wider uppercase">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {client.tokens.map((token) => (
                          <tr key={token.id} className="hover:bg-bg-hover">
                            <td className="border-border-glass text-text border-b px-2 py-2">
                              <span className="font-mono">{token.keyName}</span>
                            </td>
                            <td className="border-border-glass text-text-secondary border-b px-2 py-2">
                              {token.scope || '-'}
                            </td>
                            <td className="border-border-glass text-text-secondary border-b px-2 py-2 whitespace-nowrap">
                              {new Date(token.accessTokenExpiresAt).toLocaleString()}
                            </td>
                            <td className="border-border-glass text-text-secondary border-b px-2 py-2 whitespace-nowrap">
                              {new Date(token.createdAt).toLocaleString()}
                            </td>
                            <td className="border-border-glass border-b px-2 py-2 text-right">
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => onRevokeToken(token.id)}
                                isLoading={revokingTokenId === token.id}
                                leftIcon={<ShieldOff size={13} />}
                              >
                                Revoke
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="border-border-glass mt-3 flex flex-wrap gap-2 border-t pt-3">
                {client.status === 'disabled' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onToggleClientStatus(client)}
                    isLoading={updatingClientId === client.clientId}
                    leftIcon={<ShieldCheck size={13} />}
                  >
                    Enable
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onToggleClientStatus(client)}
                    isLoading={updatingClientId === client.clientId}
                    leftIcon={<ShieldOff size={13} />}
                  >
                    Disable
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onRevokeAllTokens(client.clientId)}
                  isLoading={revokingAllClientId === client.clientId}
                  leftIcon={<KeyRound size={13} />}
                >
                  Revoke all tokens
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onDeleteClient(client.clientId)}
                  isLoading={deletingClientId === client.clientId}
                  leftIcon={<Trash2 size={13} />}
                >
                  Delete client
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
