import { Copy, Edit2, Trash2 } from 'lucide-react';

import type { McpServer } from '../../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';

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
        <div className="text-text-secondary p-4 text-center">
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
                  className="border-border-glass bg-bg-subtle rounded-md border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onEdit(name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Edit2 size={12} className="shrink-0 opacity-60" />
                        <span className="font-heading text-text truncate text-sm font-semibold">
                          {name}
                        </span>
                      </div>
                      <div className="text-text-muted mt-1 text-xs break-all">
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
                  <div className="border-border-glass bg-bg-glass mt-3 rounded border px-2 py-1.5 text-xs">
                    <span className="text-text-muted">Headers: </span>
                    <span className="text-text-secondary font-medium">
                      {headerCount > 0 ? `${headerCount} configured` : '-'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="font-body w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th
                    className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
                    style={{ paddingLeft: '24px' }}
                  >
                    Name
                  </th>
                  <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase">
                    Upstream
                  </th>
                  <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase">
                    Path
                  </th>
                  <th className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase">
                    Status
                  </th>
                  <th
                    className="border-border-glass bg-bg-hover text-text-secondary border-b px-4 py-3 text-left text-[11px] font-semibold tracking-wider uppercase"
                    style={{ paddingRight: '24px', textAlign: 'right' }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Plexus Management MCP — fixed row */}
                <tr className="bg-primary/5 border-primary/30 border-b">
                  <td
                    className="border-border-glass text-text border-b px-4 py-3 text-left"
                    style={{ paddingLeft: '24px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontWeight: 600 }}>Plexus Management</div>
                    </div>
                  </td>
                  <td className="border-border-glass text-text-muted border-b px-4 py-3 text-left text-xs">
                    —
                  </td>
                  <td className="border-border-glass text-text border-b px-4 py-3 text-left whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">/mcp/plexus</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopyMcpPath('/mcp/plexus');
                        }}
                        className="text-text-muted hover:bg-bg-hover hover:text-text rounded p-1"
                        title="Copy path"
                        aria-label="Copy /mcp/plexus"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </td>
                  <td className="border-border-glass text-text border-b px-4 py-3 text-left">
                    <Switch checked={mcpEnabled} onChange={onToggleMcpEnabled} size="sm" />
                  </td>
                  <td
                    className="border-border-glass text-text border-b px-4 py-3 text-left"
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
                        className="border-border-glass text-text border-b px-4 py-3 text-left"
                        style={{ paddingLeft: '24px' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Edit2 size={12} style={{ opacity: 0.5 }} />
                          <div style={{ fontWeight: 600 }}>{name}</div>
                        </div>
                      </td>
                      <td className="border-border-glass text-text border-b px-4 py-3 text-left">
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
                      <td className="border-border-glass text-text border-b px-4 py-3 text-left whitespace-nowrap">
                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="font-mono text-xs">{mcpPathForServer(name)}</span>
                          <button
                            type="button"
                            onClick={() => onCopyMcpPath(mcpPathForServer(name))}
                            className="text-text-muted hover:bg-bg-hover hover:text-text rounded p-1"
                            title="Copy path"
                            aria-label={`Copy ${mcpPathForServer(name)}`}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="border-border-glass text-text border-b px-4 py-3 text-left">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={server.enabled !== false}
                            onChange={(val) => onToggleEnabled(name, val)}
                            size="sm"
                          />
                        </div>
                      </td>
                      <td
                        className="border-border-glass text-text border-b px-4 py-3 text-left"
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
