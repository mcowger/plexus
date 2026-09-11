import { Copy, Edit2, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';
import type { McpServer } from '../../lib/api';

interface McpServerTableProps {
  servers: Record<string, McpServer>;
  serverNames: string[];
  mcpEnabled: boolean;
  onEdit: (serverName: string) => void;
  onManageKeys: (serverName: string) => void;
  onToggleEnabled: (serverName: string, newState: boolean) => void | Promise<void>;
  onToggleMcpEnabled: (enabled: boolean) => void | Promise<void>;
  onDelete: (serverName: string) => void | Promise<void>;
  mcpPathForServer: (serverName: string) => string;
  onCopyMcpPath: (path: string) => void | Promise<void>;
}

export function McpServerTable({
  servers,
  serverNames,
  mcpEnabled,
  onEdit,
  onManageKeys,
  onToggleEnabled,
  onToggleMcpEnabled,
  onDelete,
  mcpPathForServer,
  onCopyMcpPath,
}: McpServerTableProps) {
  return (
    <Card title="MCP Servers">
      {serverNames.length === 0 ? (
        <div className="p-4 text-text-secondary text-center">
          No MCP servers configured. Click "Add MCP Server" to create one.
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {serverNames.map((name) => {
              const server = servers[name];
              const headerCount = server.headers ? Object.keys(server.headers).length : 0;

              return (
                <article
                  key={name}
                  className="rounded-md border border-border-glass bg-bg-subtle p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onEdit(name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Edit2 size={12} className="shrink-0 opacity-60" />
                        <span className="truncate font-heading text-sm font-semibold text-text">
                          {name}
                        </span>
                      </div>
                      <div className="mt-1 break-all text-xs text-text-muted">
                        {server.mode === 'local_http'
                          ? `${server.launcher} ${server.package} → 127.0.0.1:${server.port}${server.path || '/mcp'}`
                          : server.upstream_url}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {server.mode !== 'local_http' && (
                        <Button size="sm" variant="secondary" onClick={() => onManageKeys(name)}>
                          Manage Keys
                        </Button>
                      )}
                      <Switch
                        checked={server.enabled !== false}
                        onChange={(val) => onToggleEnabled(name, val)}
                        size="sm"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onDelete(name)}
                        className="text-danger"
                        aria-label={`Delete ${name}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 rounded border border-border-glass bg-bg-glass px-2 py-1.5 text-xs">
                    <span className="text-text-muted">Headers: </span>
                    <span className="font-medium text-text-secondary">
                      {headerCount > 0 ? `${headerCount} configured` : '-'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse font-body text-[13px]">
              <thead>
                <tr>
                  <th
                    className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                    style={{ paddingLeft: '24px' }}
                  >
                    Name
                  </th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Upstream
                  </th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Path
                  </th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                    Status
                  </th>
                  <th
                    className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                    style={{ paddingRight: '24px', textAlign: 'right' }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Plexus Management MCP — fixed row */}
                <tr className="bg-primary/5 border-b border-primary/30">
                  <td
                    className="px-4 py-3 text-left border-b border-border-glass text-text"
                    style={{ paddingLeft: '24px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontWeight: 600 }}>Plexus Management</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text-muted text-xs">
                    —
                  </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">/mcp/plexus</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopyMcpPath('/mcp/plexus');
                        }}
                        className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text"
                        title="Copy path"
                        aria-label="Copy /mcp/plexus"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                    <Switch checked={mcpEnabled} onChange={onToggleMcpEnabled} size="sm" />
                  </td>
                  <td
                    className="px-4 py-3 text-left border-b border-border-glass text-text"
                    style={{ paddingRight: '24px', textAlign: 'right' }}
                  />
                </tr>

                {serverNames.map((name) => {
                  const server = servers[name];
                  return (
                    <tr
                      key={name}
                      onClick={() => onEdit(name)}
                      style={{ cursor: 'pointer' }}
                      className="hover:bg-bg-hover"
                    >
                      <td
                        className="px-4 py-3 text-left border-b border-border-glass text-text"
                        style={{ paddingLeft: '24px' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Edit2 size={12} style={{ opacity: 0.5 }} />
                          <div style={{ fontWeight: 600 }}>{name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                        <div
                          style={{
                            maxWidth: '400px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {server.mode === 'local_http'
                            ? `${server.launcher} ${server.package} → 127.0.0.1:${server.port}${server.path || '/mcp'}`
                            : server.upstream_url}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text whitespace-nowrap">
                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="font-mono text-xs">{mcpPathForServer(name)}</span>
                          <button
                            type="button"
                            onClick={() => onCopyMcpPath(mcpPathForServer(name))}
                            className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text"
                            title="Copy path"
                            aria-label={`Copy ${mcpPathForServer(name)}`}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={server.enabled !== false}
                            onChange={(val) => onToggleEnabled(name, val)}
                            size="sm"
                          />
                        </div>
                      </td>
                      <td
                        className="px-4 py-3 text-left border-b border-border-glass text-text"
                        style={{ paddingRight: '24px', textAlign: 'right' }}
                      >
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          {server.mode !== 'local_http' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                onManageKeys(name);
                              }}
                            >
                              Manage Keys
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(name);
                            }}
                            style={{ color: 'var(--color-danger)' }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
