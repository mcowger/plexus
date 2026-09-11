import { MinusCircle, PlusCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import type { LocalMcpServer, McpServer, RemoteMcpServer } from '../../lib/api';

interface McpServerEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingServerName: string | null;
  serverNameInput: string;
  onServerNameInputChange: (value: string) => void;
  editingServer: McpServer;
  onEditingServerChange: (server: McpServer) => void;
  argsInput: string;
  onArgsInputChange: (value: string) => void;
  headerKey: string;
  onHeaderKeyChange: (value: string) => void;
  headerValue: string;
  onHeaderValueChange: (value: string) => void;
  envKey: string;
  onEnvKeyChange: (value: string) => void;
  envValue: string;
  onEnvValueChange: (value: string) => void;
  emptyServer: RemoteMcpServer;
  emptyLocalServer: LocalMcpServer;
  getNextLocalMcpPort: () => number;
  onAddHeader: () => void;
  onRemoveHeader: (key: string) => void;
  onAddEnv: () => void;
  onRemoveEnv: (key: string) => void;
  onSave: () => void | Promise<void>;
  isSaving: boolean;
}

export function McpServerEditorModal({
  isOpen,
  onClose,
  editingServerName,
  serverNameInput,
  onServerNameInputChange,
  editingServer,
  onEditingServerChange,
  argsInput,
  onArgsInputChange,
  headerKey,
  onHeaderKeyChange,
  headerValue,
  onHeaderValueChange,
  envKey,
  onEnvKeyChange,
  envValue,
  onEnvValueChange,
  emptyServer,
  emptyLocalServer,
  getNextLocalMcpPort,
  onAddHeader,
  onRemoveHeader,
  onAddEnv,
  onRemoveEnv,
  onSave,
  isSaving,
}: McpServerEditorModalProps) {
  const localServer = editingServer.mode === 'local_http' ? editingServer : null;
  const remoteServer = editingServer.mode === 'local_http' ? null : editingServer;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingServerName ? `Edit ${editingServerName}` : 'Add MCP Server'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editingServerName && (
          <Input
            label="Server Name"
            value={serverNameInput}
            onChange={(e) =>
              onServerNameInputChange(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))
            }
            placeholder="my-mcp-server"
          />
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-text-secondary">Server Type</label>
          <select
            className="w-full rounded-md border border-border-glass bg-bg-surface px-3 py-2 text-sm text-text"
            value={editingServer.mode === 'local_http' ? 'local_http' : 'remote_http'}
            onChange={(e) => {
              if (e.target.value === 'local_http') {
                onArgsInputChange((emptyLocalServer.args || []).join(' '));
                onEditingServerChange({
                  ...emptyLocalServer,
                  enabled: editingServer.enabled,
                  headers: editingServer.headers,
                  port: getNextLocalMcpPort(),
                } as LocalMcpServer);
              } else {
                onEditingServerChange({
                  ...emptyServer,
                  enabled: editingServer.enabled,
                  headers: editingServer.headers,
                } as RemoteMcpServer);
              }
            }}
          >
            <option value="remote_http">Remote HTTP</option>
            <option value="local_http">Local HTTP</option>
          </select>
        </div>

        {localServer ? (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-text-secondary">Launcher</label>
              <select
                className="w-full rounded-md border border-border-glass bg-bg-surface px-3 py-2 text-sm text-text"
                value={localServer.launcher}
                onChange={(e) =>
                  onEditingServerChange({
                    ...localServer,
                    launcher: e.target.value as 'bunx' | 'uvx',
                  })
                }
              >
                <option value="bunx">bunx</option>
                <option value="uvx">uvx</option>
              </select>
            </div>
            <Input
              label="Package"
              value={localServer.package}
              onChange={(e) => onEditingServerChange({ ...localServer, package: e.target.value })}
              placeholder="@example/mcp-server"
            />
            <Input
              label="Arguments"
              value={argsInput}
              onChange={(e) => onArgsInputChange(e.target.value)}
              placeholder="--port {{PORT}}"
            />
            <p className="-mt-2 text-xs text-text-muted">
              Available interpolations: {'{{PORT}}'} for the configured port and {'{{HOST}}'} for
              127.0.0.1.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label="Port"
                type="number"
                value={localServer.port}
                onChange={(e) =>
                  onEditingServerChange({
                    ...localServer,
                    port: parseInt(e.target.value) || 7345,
                  })
                }
              />
              <Input
                label="Path"
                value={localServer.path ?? '/mcp'}
                onChange={(e) => onEditingServerChange({ ...localServer, path: e.target.value })}
              />
              <Input
                label="Startup Timeout (ms)"
                type="number"
                value={localServer.startup_timeout_ms || 30000}
                onChange={(e) =>
                  onEditingServerChange({
                    ...localServer,
                    startup_timeout_ms: parseInt(e.target.value) || 30000,
                  })
                }
              />
            </div>

            <div className="space-y-2 rounded-md border border-border-glass p-3">
              <label className="text-sm font-medium text-text-secondary">
                Environment Variables
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Env Key"
                    value={envKey}
                    onChange={(e) => onEnvKeyChange(e.target.value)}
                    placeholder="API_KEY"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Input
                    label="Env Value"
                    value={envValue}
                    onChange={(e) => onEnvValueChange(e.target.value)}
                    placeholder="secret value"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAddEnv}
                  className="w-full sm:w-auto"
                >
                  <PlusCircle size={16} />
                </Button>
              </div>
              {localServer.env && Object.keys(localServer.env).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(localServer.env).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-2 p-2 bg-bg-hover rounded-md sm:flex-row sm:items-center"
                    >
                      <span className="min-w-0 flex-1 break-all font-mono text-xs">{key}</span>
                      <span className="flex-1 font-mono text-xs text-text-secondary truncate">
                        {value}
                      </span>
                      <button
                        onClick={() => onRemoveEnv(key)}
                        className="p-1 hover:bg-bg-surface rounded"
                      >
                        <MinusCircle size={14} className="text-danger" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <Input
            label="Upstream URL"
            value={remoteServer?.upstream_url ?? ''}
            onChange={(e) =>
              onEditingServerChange({
                ...(remoteServer || emptyServer),
                upstream_url: e.target.value,
              })
            }
            placeholder="https://mcp.example.com/mcp"
          />
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Auth Scheme"
            value={editingServer.auth_scheme ?? ''}
            onChange={(e) =>
              onEditingServerChange({ ...editingServer, auth_scheme: e.target.value || null })
            }
            placeholder="bearer"
          />
          <Input
            label="Rate Limit Cooldown (ms)"
            type="number"
            min="0"
            value={editingServer.rate_limit_cooldown_ms ?? 60_000}
            onChange={(e) =>
              onEditingServerChange({
                ...editingServer,
                rate_limit_cooldown_ms: Number(e.target.value),
              })
            }
          />
          <Input
            label="Quota Cooldown (ms)"
            type="number"
            min="0"
            value={editingServer.quota_cooldown_ms ?? 86_400_000}
            onChange={(e) =>
              onEditingServerChange({
                ...editingServer,
                quota_cooldown_ms: Number(e.target.value),
              })
            }
          />
        </div>

        <div className="mt-4 rounded-md border border-border-glass p-3">
          <div className="mb-3">
            <label className="text-sm font-medium text-text-secondary">
              Static Headers (Optional)
            </label>
            <p className="text-xs text-text-muted mt-1">
              These headers are injected into every request. For load-balanced authentication keys,
              use the <strong>Auth Scheme</strong> above and the <strong>Manage Keys</strong>{' '}
              button.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Input
                label="Header Key"
                value={headerKey}
                onChange={(e) => onHeaderKeyChange(e.target.value)}
                placeholder="X-Custom-Header"
              />
            </div>
            <div className="min-w-0 flex-1">
              <Input
                label="Header Value"
                value={headerValue}
                onChange={(e) => onHeaderValueChange(e.target.value)}
                placeholder="value..."
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddHeader}
              className="w-full sm:w-auto"
            >
              <PlusCircle size={16} />
            </Button>
          </div>

          {editingServer.headers && Object.keys(editingServer.headers).length > 0 && (
            <div className="space-y-2 mt-4">
              <label className="text-sm font-medium text-text-secondary">
                Configured Static Headers
              </label>
              {Object.entries(editingServer.headers).map(([key, value]) => (
                <div
                  key={key}
                  className="flex flex-col gap-2 p-2 bg-bg-hover rounded-md sm:flex-row sm:items-center"
                >
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">{key}</span>
                  <span className="flex-1 font-mono text-xs text-text-secondary truncate">
                    {value}
                  </span>
                  <button
                    onClick={() => onRemoveHeader(key)}
                    className="p-1 hover:bg-bg-surface rounded"
                  >
                    <MinusCircle size={14} className="text-danger" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
