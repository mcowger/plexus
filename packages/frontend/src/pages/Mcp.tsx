import { useEffect, useState, useRef } from 'react';
import {
  api,
  McpServer,
  McpLogRecord,
  McpOAuthClientRecord,
  McpServerKey,
  RemoteMcpServer,
  LocalMcpServer,
} from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CopyButton } from '../components/ui/CopyButton';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { McpServerTable } from '../components/mcp/McpServerTable';
import { McpOAuthClientsCard } from '../components/mcp/McpOAuthClientsCard';
import { McpUsageLogsCard } from '../components/mcp/McpUsageLogsCard';
import { McpServerEditorModal } from '../components/mcp/McpServerEditorModal';
import { McpKeyManagementModal } from '../components/mcp/McpKeyManagementModal';
import { McpDeleteLogsModal } from '../components/mcp/McpDeleteLogsModal';
import { McpDeleteLogModal } from '../components/mcp/McpDeleteLogModal';
import { useToast } from '../contexts/ToastContext';
import { Plus, Download, Package } from 'lucide-react';
import { clsx } from 'clsx';
import { isClipboardAvailable, copyToClipboard } from '../lib/clipboard';
import plexusCliSkill from '../../../../.agents/skills/plexus-cli/SKILL.md' with { type: 'text' };
import plexusRestApiSkill from '../../../../.agents/skills/plexus-rest-api/SKILL.md' with {
  type: 'text',
};

const LOCAL_MCP_DEFAULT_PORT = 7345;
const CLI_BUNX_COMMAND = 'bunx @mcowger/plexus-cli';
const CLI_GLOBAL_INSTALL_COMMAND = 'bun install -g @mcowger/plexus-cli';

const EMPTY_SERVER: RemoteMcpServer = {
  mode: 'remote_http',
  upstream_url: '',
  enabled: true,
  headers: {},
};

const EMPTY_LOCAL_SERVER: LocalMcpServer = {
  mode: 'local_http',
  enabled: true,
  launcher: 'bunx',
  package: '',
  args: ['--port', '{{PORT}}'],
  env: {},
  port: LOCAL_MCP_DEFAULT_PORT,
  path: '/mcp',
  startup_timeout_ms: 30000,
  headers: {},
};

export const McpPage: React.FC = () => {
  const toast = useToast();
  const [servers, setServers] = useState<Record<string, McpServer>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [serverNameInput, setServerNameInput] = useState('');
  const [editingServer, setEditingServer] = useState<McpServer>(EMPTY_SERVER);
  const [isSaving, setIsSaving] = useState(false);
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [argsInput, setArgsInput] = useState((EMPTY_LOCAL_SERVER.args || []).join(' '));
  const [keyManagementServerName, setKeyManagementServerName] = useState<string | null>(null);
  const [serverKeys, setServerKeys] = useState<McpServerKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [newServerKey, setNewServerKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isCliInstallOpen, setIsCliInstallOpen] = useState(false);
  const [, setCurrentTime] = useState(Date.now());

  // Logs state
  const [logs, setLogs] = useState<McpLogRecord[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLimit] = useState(20);
  const [logsOffset, setLogsOffset] = useState(0);
  const [logsFilters, setLogsFilters] = useState({ serverName: '', apiKey: '' });

  // OAuth clients/tokens state
  const [oauthClients, setOauthClients] = useState<McpOAuthClientRecord[]>([]);
  const [oauthClientsLoading, setOauthClientsLoading] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<number | null>(null);
  const [updatingClientId, setUpdatingClientId] = useState<string | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
  const [revokingAllClientId, setRevokingAllClientId] = useState<string | null>(null);

  // Delete logs modal state
  const [isDeleteLogsModalOpen, setIsDeleteLogsModalOpen] = useState(false);
  const [deleteLogsMode, setDeleteLogsMode] = useState<'all' | 'older'>('older');
  const [olderThanDays, setOlderThanDays] = useState(7);
  const [isDeletingLogs, setIsDeletingLogs] = useState(false);

  // Single log delete state
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [isSingleDeleteModalOpen, setIsSingleDeleteModalOpen] = useState(false);

  const logsFiltersRef = useRef(logsFilters);
  useEffect(() => {
    logsFiltersRef.current = logsFilters;
  }, [logsFilters]);

  useEffect(() => {
    loadData();
    loadOAuthClients();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [logsOffset]);

  useEffect(() => {
    if (!keyManagementServerName) return;
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [keyManagementServerName]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [data, enabled] = await Promise.all([api.getMcpServers(), api.getMcpEnabled()]);
      setServers(data);
      setMcpEnabled(enabled.enabled);
    } catch (e) {
      console.error('Failed to load MCP servers', e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const filters: { serverName?: string; apiKey?: string } = {};
      if (logsFilters.serverName) filters.serverName = logsFilters.serverName;
      if (logsFilters.apiKey) filters.apiKey = logsFilters.apiKey;
      const res = await api.getMcpLogs(logsLimit, logsOffset, filters);
      setLogs(res.data);
      setLogsTotal(Number(res.total) || 0);
    } catch (e) {
      console.error('Failed to load MCP logs', e);
    } finally {
      setLogsLoading(false);
    }
  };

  const loadOAuthClients = async () => {
    setOauthClientsLoading(true);
    try {
      const clients = await api.getMcpOAuthClients();
      setOauthClients(clients);
    } catch (e) {
      console.error('Failed to load MCP OAuth clients', e);
      toast.error('Failed to load MCP OAuth clients');
    } finally {
      setOauthClientsLoading(false);
    }
  };

  const handleRevokeOAuthToken = async (tokenId: number) => {
    const ok = await toast.confirm({
      title: 'Revoke OAuth token?',
      message: 'The client will need to reconnect before it can access MCP with this token again.',
      confirmLabel: 'Revoke',
      variant: 'danger',
    });
    if (!ok) return;

    setRevokingTokenId(tokenId);
    try {
      await api.revokeMcpOAuthToken(tokenId);
      await loadOAuthClients();
      toast.success('OAuth token revoked');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to revoke OAuth token');
    } finally {
      setRevokingTokenId(null);
    }
  };

  const handleToggleOAuthClientStatus = async (client: McpOAuthClientRecord) => {
    const disabling = client.status !== 'disabled';
    const ok = await toast.confirm({
      title: disabling ? 'Disable OAuth client?' : 'Re-enable OAuth client?',
      message: disabling
        ? 'Disable this OAuth client? It will no longer be able to authorize or exchange tokens.'
        : 'Re-enable this OAuth client?',
      confirmLabel: disabling ? 'Disable' : 'Re-enable',
      variant: disabling ? 'danger' : 'default',
    });
    if (!ok) return;

    setUpdatingClientId(client.clientId);
    try {
      await api.updateMcpOAuthClientStatus(client.clientId, disabling ? 'disabled' : 'active');
      await loadOAuthClients();
      toast.success(disabling ? 'OAuth client disabled' : 'OAuth client re-enabled');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to update OAuth client');
    } finally {
      setUpdatingClientId(null);
    }
  };

  const handleRevokeAllOAuthTokens = async (clientId: string) => {
    const ok = await toast.confirm({
      title: 'Revoke all tokens?',
      message: 'Revoke all tokens for this client? This cannot be undone.',
      confirmLabel: 'Revoke all',
      variant: 'danger',
    });
    if (!ok) return;

    setRevokingAllClientId(clientId);
    try {
      await api.revokeMcpOAuthClientTokens(clientId);
      await loadOAuthClients();
      toast.success('All tokens revoked for this client');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to revoke all tokens');
    } finally {
      setRevokingAllClientId(null);
    }
  };

  const handleDeleteOAuthClient = async (clientId: string) => {
    const ok = await toast.confirm({
      title: 'Delete OAuth client?',
      message: 'Delete this OAuth client? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    setDeletingClientId(clientId);
    try {
      await api.deleteMcpOAuthClient(clientId);
      await loadOAuthClients();
      toast.success('OAuth client deleted');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to delete OAuth client');
    } finally {
      setDeletingClientId(null);
    }
  };

  const handleLogSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLogsOffset(0);
    loadLogs();
  };

  const handleDeleteAllLogs = () => {
    setIsDeleteLogsModalOpen(true);
  };

  const confirmDeleteAllLogs = async () => {
    setIsDeletingLogs(true);
    try {
      if (deleteLogsMode === 'all') {
        await api.deleteAllMcpLogs();
      } else {
        await api.deleteAllMcpLogs(olderThanDays);
      }
      setLogsOffset(0);
      await loadLogs();
      setIsDeleteLogsModalOpen(false);
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const handleDeleteLog = (requestId: string) => {
    setSelectedLogId(requestId);
    setIsSingleDeleteModalOpen(true);
  };

  const confirmDeleteSingleLog = async () => {
    if (!selectedLogId) return;
    setIsDeletingLogs(true);
    try {
      await api.deleteMcpLog(selectedLogId);
      setLogs(logs.filter((l) => l.request_id !== selectedLogId));
      setLogsTotal((prev) => Math.max(0, prev - 1));
      setIsSingleDeleteModalOpen(false);
      setSelectedLogId(null);
    } catch (e) {
      console.error('Failed to delete MCP log', e);
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const getNextLocalMcpPort = (): number => {
    const usedPorts = new Set(
      Object.entries(servers)
        .filter(([name]) => name !== editingServerName)
        .map(([, server]) => (server.mode === 'local_http' ? server.port : null))
        .filter((port): port is number => typeof port === 'number')
    );

    let port = LOCAL_MCP_DEFAULT_PORT;
    while (usedPorts.has(port) && port < 65535) {
      port += 1;
    }
    return port;
  };

  const parseArguments = (input: string): string[] => {
    const args: string[] = [];
    let current = '';
    let quote: 'single' | 'double' | null = null;
    let escaping = false;

    for (const char of input) {
      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"' && quote !== 'single') {
        quote = quote === 'double' ? null : 'double';
        continue;
      }
      if (char === "'" && quote !== 'double') {
        quote = quote === 'single' ? null : 'single';
        continue;
      }
      if (/\s/.test(char) && quote === null) {
        if (current) {
          args.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (escaping) current += '\\';
    if (current) args.push(current);
    return args;
  };

  const handleAddNew = () => {
    setEditingServerName(null);
    setServerNameInput('');
    setEditingServer({ ...EMPTY_SERVER });
    setHeaderKey('');
    setHeaderValue('');
    setEnvKey('');
    setEnvValue('');
    setArgsInput((EMPTY_LOCAL_SERVER.args || []).join(' '));
    setIsModalOpen(true);
  };

  const handleEdit = (serverName: string) => {
    const server = servers[serverName];
    if (!server) return;
    setEditingServerName(serverName);
    setServerNameInput(serverName);
    setEditingServer({ ...server });
    setHeaderKey('');
    setHeaderValue('');
    setEnvKey('');
    setEnvValue('');
    setArgsInput(
      server.mode === 'local_http'
        ? (server.args || []).join(' ')
        : (EMPTY_LOCAL_SERVER.args || []).join(' ')
    );
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const nameToSave = editingServerName || serverNameInput;
    if (!nameToSave || !nameToSave.trim()) {
      toast.error('Server Name is required');
      return;
    }
    if (!editingServerName && !isValidServerName(nameToSave)) {
      toast.error(
        'Invalid server name. Use lowercase letters, numbers, hyphens, and underscores (2-63 characters, must start with letter or number)'
      );
      return;
    }
    if (
      editingServer.mode !== 'local_http' &&
      (!editingServer.upstream_url || !editingServer.upstream_url.trim())
    ) {
      toast.error('Upstream URL is required');
      return;
    }
    if (editingServer.mode === 'local_http' && !editingServer.package.trim()) {
      toast.error('Package name is required');
      return;
    }

    // Auto-commit any pending header entry that hasn't been added via the + button
    const finalHeaders = { ...editingServer.headers };
    if (headerKey.trim() && headerValue.trim()) {
      finalHeaders[headerKey.trim()] = headerValue.trim();
    }
    const finalEnv = editingServer.mode === 'local_http' ? { ...editingServer.env } : undefined;
    if (finalEnv && envKey.trim()) {
      finalEnv[envKey.trim()] = envValue;
    }

    setIsSaving(true);
    try {
      const serverSettings = {
        auth_scheme: editingServer.auth_scheme?.trim() || null,
        rate_limit_cooldown_ms: editingServer.rate_limit_cooldown_ms ?? 60_000,
        quota_cooldown_ms: editingServer.quota_cooldown_ms ?? 86_400_000,
      };
      await api.saveMcpServer(
        nameToSave,
        editingServer.mode === 'local_http'
          ? {
              ...editingServer,
              ...serverSettings,
              args: parseArguments(argsInput),
              headers: finalHeaders,
              env: finalEnv,
            }
          : { ...editingServer, ...serverSettings, headers: finalHeaders }
      );
      await loadData();
      setIsModalOpen(false);
    } catch (e) {
      console.error('Save error', e);
      toast.error(`Failed to save MCP server: ${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (serverName: string) => {
    const ok = await toast.confirm({
      title: 'Delete MCP server?',
      message: `Are you sure you want to delete the MCP server "${serverName}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteMcpServer(serverName);
      await loadData();
      toast.success(`Deleted ${serverName}`);
    } catch (e) {
      console.error('Delete error', e);
      toast.error(`Failed to delete MCP server: ${e}`);
    }
  };

  const handleToggleEnabled = async (serverName: string, newState: boolean) => {
    const server = servers[serverName];
    if (!server) return;

    try {
      await api.saveMcpServer(serverName, {
        ...server,
        enabled: newState,
      });
      await loadData();
    } catch (e) {
      console.error('Toggle error', e);
      toast.error(`Failed to update MCP server: ${e}`);
    }
  };

  const handleToggleMcpEnabled = async (enabled: boolean) => {
    setMcpEnabled(enabled);
    try {
      await api.patchMcpEnabled(enabled);
      toast.success(`MCP server ${enabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      setMcpEnabled(!enabled); // revert on failure
      toast.error((e as Error).message, 'Failed to update MCP server state');
    }
  };

  const loadServerKeys = async (serverName: string) => {
    setIsLoadingKeys(true);
    try {
      setServerKeys(await api.getMcpServerKeys(serverName));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleManageKeys = (serverName: string) => {
    setKeyManagementServerName(serverName);
    setNewServerKey('');
    setServerKeys([]);
    void loadServerKeys(serverName);
  };

  const handleAddServerKey = async () => {
    if (!keyManagementServerName || !newServerKey.trim()) return;
    setIsSavingKey(true);
    try {
      await api.addMcpServerKey(keyManagementServerName, newServerKey.trim());
      setNewServerKey('');
      await loadServerKeys(keyManagementServerName);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleDeleteServerKey = async (keyId: number) => {
    if (!keyManagementServerName) return;
    try {
      await api.deleteMcpServerKey(keyManagementServerName, keyId);
      await loadServerKeys(keyManagementServerName);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleClearServerKeyCooldown = async (keyId: number) => {
    if (!keyManagementServerName) return;
    try {
      await api.clearMcpServerKeyCooldown(keyManagementServerName, keyId);
      await loadServerKeys(keyManagementServerName);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const isValidServerName = (name: string): boolean => {
    return /^[a-z0-9][a-z0-9-_]{1,62}$/.test(name);
  };

  const addHeader = () => {
    if (!headerKey.trim() || !headerValue.trim()) return;
    setEditingServer({
      ...editingServer,
      headers: {
        ...editingServer.headers,
        [headerKey.trim()]: headerValue.trim(),
      },
    });
    setHeaderKey('');
    setHeaderValue('');
  };

  const removeHeader = (key: string) => {
    const newHeaders = { ...editingServer.headers };
    delete newHeaders[key];
    setEditingServer({
      ...editingServer,
      headers: newHeaders,
    });
  };

  const addEnv = () => {
    if (editingServer.mode !== 'local_http' || !envKey.trim()) return;
    setEditingServer({
      ...editingServer,
      env: {
        ...editingServer.env,
        [envKey.trim()]: envValue,
      },
    });
    setEnvKey('');
    setEnvValue('');
  };

  const removeEnv = (key: string) => {
    if (editingServer.mode !== 'local_http') return;
    const newEnv = { ...editingServer.env };
    delete newEnv[key];
    setEditingServer({
      ...editingServer,
      env: newEnv,
    });
  };

  const serverNames = Object.keys(servers);

  if (isLoading) {
    return (
      <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
        <Card title="MCP Servers">
          <div className="p-4 text-text-secondary">Loading...</div>
        </Card>
      </div>
    );
  }

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopySkill = async (skill: string, name: string) => {
    const canCopy = isClipboardAvailable();
    if (!canCopy) {
      toast.error('Copy requires HTTPS connection');
      return;
    }
    const success = await copyToClipboard(skill);
    if (success) {
      toast.success(`${name} copied to clipboard`);
    } else {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownloadSkill = (skill: string, filename: string) => {
    triggerDownload(skill, filename, 'text/markdown');
  };

  const mcpPathForServer = (name: string) => `/mcp/${name}`;

  const handleCopyMcpPath = async (path: string) => {
    if (!isClipboardAvailable()) {
      toast.error('Copy requires HTTPS connection');
      return;
    }
    const success = await copyToClipboard(path);
    if (success) {
      toast.success(`Copied ${path}`);
    } else {
      toast.error('Failed to copy path');
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="MCP & Skills"
        subtitle="Model Context Protocol connections and the Plexus admin skill"
        actions={
          <>
            <div className="relative inline-flex">
              <div className="inline-flex overflow-hidden rounded-md border border-border-glass">
                <button
                  type="button"
                  onClick={() => handleCopySkill(plexusCliSkill, 'Plexus CLI Skill')}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all duration-fast',
                    'bg-gradient-to-br from-secondary to-primary text-[#1A1006]',
                    'hover:brightness-105',
                    'border-r border-[#1A1006]/20'
                  )}
                >
                  Plexus CLI Skill
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadSkill(plexusCliSkill, 'plexus-cli-SKILL.md')}
                  title="Download skill as file"
                  aria-label="Download Plexus CLI skill"
                  className={clsx(
                    'inline-flex items-center justify-center px-2 py-1.5 text-xs',
                    'bg-gradient-to-br from-secondary to-primary text-[#1A1006]',
                    'hover:brightness-105',
                    'border-r border-[#1A1006]/20'
                  )}
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsCliInstallOpen((open) => !open)}
                  title="Install Plexus CLI"
                  aria-label="Install Plexus CLI"
                  aria-expanded={isCliInstallOpen}
                  className={clsx(
                    'inline-flex items-center justify-center px-2 py-1.5 text-xs',
                    'bg-gradient-to-br from-secondary to-primary text-[#1A1006]',
                    'hover:brightness-105'
                  )}
                >
                  <Package size={14} />
                </button>
              </div>
              {isCliInstallOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-md border border-border-glass bg-bg-surface p-3 shadow-lg">
                  <p className="mb-2 text-xs font-medium text-text">Install Plexus CLI</p>
                  <div className="mb-2 flex items-center gap-1 rounded bg-bg-glass px-2 py-1 font-mono text-xs text-text-secondary">
                    <code className="min-w-0 flex-1 break-all">{CLI_BUNX_COMMAND}</code>
                    <CopyButton value={CLI_BUNX_COMMAND} label="Copy bunx command" size="sm" />
                  </div>
                  <div className="flex items-center gap-1 rounded bg-bg-glass px-2 py-1 font-mono text-xs text-text-secondary">
                    <code className="min-w-0 flex-1 break-all">{CLI_GLOBAL_INSTALL_COMMAND}</code>
                    <CopyButton
                      value={CLI_GLOBAL_INSTALL_COMMAND}
                      label="Copy Bun install command"
                      size="sm"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="inline-flex rounded-md overflow-hidden border border-border-glass">
              <button
                type="button"
                onClick={() => handleCopySkill(plexusRestApiSkill, 'Plexus REST API Skill')}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all duration-fast',
                  'bg-gradient-to-br from-secondary to-primary text-[#1A1006]',
                  'hover:brightness-105',
                  'border-r border-[#1A1006]/20'
                )}
              >
                Plexus REST API Skill
              </button>
              <button
                type="button"
                onClick={() => handleDownloadSkill(plexusRestApiSkill, 'plexus-rest-api-SKILL.md')}
                title="Download as file"
                className={clsx(
                  'inline-flex items-center justify-center px-2 py-1.5 text-xs',
                  'bg-gradient-to-br from-secondary to-primary text-[#1A1006]',
                  'hover:brightness-105'
                )}
              >
                <Download size={14} />
              </button>
            </div>
            <Button leftIcon={<Plus size={14} />} onClick={handleAddNew} size="sm">
              Add server
            </Button>
          </>
        }
      />
      <PageContainer>
        <div className="flex flex-col gap-5">
          <McpServerTable
            servers={servers}
            serverNames={serverNames}
            mcpEnabled={mcpEnabled}
            onEdit={handleEdit}
            onManageKeys={handleManageKeys}
            onToggleEnabled={handleToggleEnabled}
            onToggleMcpEnabled={handleToggleMcpEnabled}
            onDelete={handleDelete}
            mcpPathForServer={mcpPathForServer}
            onCopyMcpPath={handleCopyMcpPath}
          />

          <McpOAuthClientsCard
            oauthClients={oauthClients}
            oauthClientsLoading={oauthClientsLoading}
            revokingTokenId={revokingTokenId}
            updatingClientId={updatingClientId}
            deletingClientId={deletingClientId}
            revokingAllClientId={revokingAllClientId}
            onRefresh={loadOAuthClients}
            onRevokeToken={handleRevokeOAuthToken}
            onToggleClientStatus={handleToggleOAuthClientStatus}
            onRevokeAllTokens={handleRevokeAllOAuthTokens}
            onDeleteClient={handleDeleteOAuthClient}
          />

          <McpUsageLogsCard
            logs={logs}
            logsTotal={logsTotal}
            logsLoading={logsLoading}
            logsLimit={logsLimit}
            logsOffset={logsOffset}
            logsFilters={logsFilters}
            onFiltersChange={setLogsFilters}
            onSearch={handleLogSearch}
            onDeleteAll={handleDeleteAllLogs}
            onDeleteLog={handleDeleteLog}
            onOffsetChange={setLogsOffset}
          />

          <McpServerEditorModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            editingServerName={editingServerName}
            serverNameInput={serverNameInput}
            onServerNameInputChange={setServerNameInput}
            editingServer={editingServer}
            onEditingServerChange={setEditingServer}
            argsInput={argsInput}
            onArgsInputChange={setArgsInput}
            headerKey={headerKey}
            onHeaderKeyChange={setHeaderKey}
            headerValue={headerValue}
            onHeaderValueChange={setHeaderValue}
            envKey={envKey}
            onEnvKeyChange={setEnvKey}
            envValue={envValue}
            onEnvValueChange={setEnvValue}
            emptyServer={EMPTY_SERVER}
            emptyLocalServer={EMPTY_LOCAL_SERVER}
            getNextLocalMcpPort={getNextLocalMcpPort}
            onAddHeader={addHeader}
            onRemoveHeader={removeHeader}
            onAddEnv={addEnv}
            onRemoveEnv={removeEnv}
            onSave={handleSave}
            isSaving={isSaving}
          />

          <McpKeyManagementModal
            serverName={keyManagementServerName}
            authScheme={
              keyManagementServerName ? servers[keyManagementServerName]?.auth_scheme : undefined
            }
            serverKeys={serverKeys}
            isLoadingKeys={isLoadingKeys}
            newServerKey={newServerKey}
            onNewServerKeyChange={setNewServerKey}
            isSavingKey={isSavingKey}
            onClose={() => setKeyManagementServerName(null)}
            onAddKey={handleAddServerKey}
            onDeleteKey={handleDeleteServerKey}
            onClearCooldown={handleClearServerKeyCooldown}
          />

          <McpDeleteLogsModal
            isOpen={isDeleteLogsModalOpen}
            deleteLogsMode={deleteLogsMode}
            olderThanDays={olderThanDays}
            isDeletingLogs={isDeletingLogs}
            onClose={() => setIsDeleteLogsModalOpen(false)}
            onModeChange={setDeleteLogsMode}
            onOlderThanDaysChange={setOlderThanDays}
            onConfirm={confirmDeleteAllLogs}
          />

          <McpDeleteLogModal
            isOpen={isSingleDeleteModalOpen}
            isDeletingLogs={isDeletingLogs}
            onClose={() => setIsSingleDeleteModalOpen(false)}
            onConfirm={confirmDeleteSingleLog}
          />
        </div>
      </PageContainer>
    </div>
  );
};

export default McpPage;
