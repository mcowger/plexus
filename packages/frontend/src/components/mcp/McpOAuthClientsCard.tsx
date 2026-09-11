import { KeyRound, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import type { McpOAuthClientRecord } from '../../lib/api';

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
    <Card className="glass-bg rounded-lg p-3 max-w-full shadow-xl overflow-hidden flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold text-text m-0 mb-1">
            MCP OAuth Clients
          </h2>
          <p className="text-xs text-text-muted">
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
        <div className="py-8 text-center text-sm text-text-secondary">Loading...</div>
      ) : oauthClients.length === 0 ? (
        <div className="rounded-md border border-border-glass bg-bg-subtle p-4 text-sm text-text-secondary">
          No MCP OAuth clients registered yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {oauthClients.map((client) => (
            <article
              key={client.clientId}
              className={`rounded-md border border-border-glass bg-bg-subtle p-3 ${
                client.status === 'disabled' ? 'opacity-60' : ''
              }`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-text">
                    <KeyRound size={15} className="text-primary" />
                    <span>{client.clientName || 'Unnamed client'}</span>
                    {client.status === 'disabled' ? (
                      <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-500">
                        Disabled
                      </span>
                    ) : (
                      <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-500">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-text-secondary break-all">
                    {client.clientId}
                  </div>
                  <div className="mt-2 text-xs text-text-muted">
                    Created {new Date(client.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="min-w-0 lg:max-w-[45%]">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">
                    Redirect URIs
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {client.redirectUris.map((uri) => (
                      <code
                        key={uri}
                        className="rounded border border-border-glass bg-bg-glass px-2 py-1 text-[11px] text-text-secondary break-all"
                      >
                        {uri}
                      </code>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 border-t border-border-glass pt-3">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-text-muted">
                  Active tokens
                </div>
                {client.tokens.length === 0 ? (
                  <div className="text-xs text-text-muted">No active tokens for this client.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse font-body text-[12px]">
                      <thead>
                        <tr>
                          <th className="px-2 py-2 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[10px] uppercase tracking-wider">
                            Key name
                          </th>
                          <th className="px-2 py-2 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[10px] uppercase tracking-wider">
                            Scope
                          </th>
                          <th className="px-2 py-2 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[10px] uppercase tracking-wider">
                            Access expires
                          </th>
                          <th className="px-2 py-2 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[10px] uppercase tracking-wider">
                            Issued
                          </th>
                          <th className="px-2 py-2 text-right border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[10px] uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {client.tokens.map((token) => (
                          <tr key={token.id} className="hover:bg-bg-hover">
                            <td className="px-2 py-2 border-b border-border-glass text-text">
                              <span className="font-mono">{token.keyName}</span>
                            </td>
                            <td className="px-2 py-2 border-b border-border-glass text-text-secondary">
                              {token.scope || '-'}
                            </td>
                            <td className="px-2 py-2 border-b border-border-glass text-text-secondary whitespace-nowrap">
                              {new Date(token.accessTokenExpiresAt).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 border-b border-border-glass text-text-secondary whitespace-nowrap">
                              {new Date(token.createdAt).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 border-b border-border-glass text-right">
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

              <div className="mt-3 flex flex-wrap gap-2 border-t border-border-glass pt-3">
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
