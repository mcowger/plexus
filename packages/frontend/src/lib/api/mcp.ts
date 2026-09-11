import { API_BASE, fetchWithAuth } from './core';
import type {
  LocalMcpRuntimeStatus,
  McpLogRecord,
  McpOAuthClientRecord,
  McpServer,
  McpServerKey,
} from '../../types/mcp';

export const getMcpServers = async (): Promise<Record<string, McpServer>> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-servers`);
    if (!res.ok) throw new Error('Failed to fetch MCP servers');
    return await res.json();
  } catch (e) {
    console.error('API Error getMcpServers', e);
    return {};
  }
};

export const saveMcpServer = async (serverName: string, server: McpServer): Promise<void> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(server),
      }
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Failed to save MCP server');
    }
  } catch (e) {
    console.error('API Error saveMcpServer', e);
    throw e;
  }
};

export const deleteMcpServer = async (serverName: string): Promise<void> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}`,
      {
        method: 'DELETE',
      }
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Failed to delete MCP server');
    }
  } catch (e) {
    console.error('API Error deleteMcpServer', e);
    throw e;
  }
};

export const getMcpServerKeys = async (serverName: string): Promise<McpServerKey[]> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/keys`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('Failed to fetch MCP server keys');
  const data = (await res.json()) as { keys: McpServerKey[] };
  return data.keys;
};

export const addMcpServerKey = async (serverName: string, key: string): Promise<McpServerKey> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/keys`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }
  );
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error || 'Failed to add MCP server key');
  }
  return await res.json();
};

export const deleteMcpServerKey = async (serverName: string, keyId: number): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/keys/${keyId}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error('Failed to delete MCP server key');
};

export const clearMcpServerKeyCooldown = async (
  serverName: string,
  keyId: number
): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/keys/${keyId}/clear-cooldown`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Failed to clear MCP server key cooldown');
};

export const getMcpServerStatus = async (serverName: string): Promise<LocalMcpRuntimeStatus> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/status`
  );
  if (!res.ok) throw new Error('Failed to fetch MCP server status');
  return await res.json();
};

export const startMcpServer = async (serverName: string): Promise<LocalMcpRuntimeStatus> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/start`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Failed to start MCP server');
  return await res.json();
};

export const stopMcpServer = async (serverName: string): Promise<LocalMcpRuntimeStatus> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/stop`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Failed to stop MCP server');
  return await res.json();
};

export const restartMcpServer = async (serverName: string): Promise<LocalMcpRuntimeStatus> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}/restart`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Failed to restart MCP server');
  return await res.json();
};

export const getMcpLogs = async (
  limit: number = 20,
  offset: number = 0,
  filters: { serverName?: string; apiKey?: string } = {}
): Promise<{ data: McpLogRecord[]; total: number }> => {
  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      ...(filters.serverName ? { serverName: filters.serverName } : {}),
      ...(filters.apiKey ? { apiKey: filters.apiKey } : {}),
    });
    const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-logs?${params}`);
    if (!res.ok) throw new Error('Failed to fetch MCP logs');
    return await res.json();
  } catch (e) {
    console.error('API Error getMcpLogs', e);
    return { data: [], total: 0 };
  }
};

export const getMcpOAuthClients = async (): Promise<McpOAuthClientRecord[]> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-oauth/clients`);
    if (!res.ok) throw new Error('Failed to fetch MCP OAuth clients');
    const body = (await res.json()) as { clients: McpOAuthClientRecord[] };
    return body.clients || [];
  } catch (e) {
    console.error('API Error getMcpOAuthClients', e);
    return [];
  }
};

export const revokeMcpOAuthToken = async (tokenId: number): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-oauth/tokens/${encodeURIComponent(String(tokenId))}/revoke`,
    { method: 'POST' }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to revoke MCP OAuth token');
  }
};

export const updateMcpOAuthClientStatus = async (
  clientId: string,
  status: 'active' | 'disabled'
): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-oauth/clients/${encodeURIComponent(clientId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to update MCP OAuth client status');
  }
};

export const deleteMcpOAuthClient = async (clientId: string): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-oauth/clients/${encodeURIComponent(clientId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to delete MCP OAuth client');
  }
};

export const revokeMcpOAuthClientTokens = async (clientId: string): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/mcp-oauth/clients/${encodeURIComponent(clientId)}/revoke`,
    { method: 'POST' }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to revoke MCP OAuth client tokens');
  }
};

export const deleteMcpLog = async (requestId: string): Promise<boolean> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/mcp-logs/${encodeURIComponent(requestId)}`,
      {
        method: 'DELETE',
      }
    );
    return res.ok;
  } catch (e) {
    console.error('API Error deleteMcpLog', e);
    return false;
  }
};

export const deleteAllMcpLogs = async (olderThanDays?: number): Promise<boolean> => {
  try {
    const params = olderThanDays != null ? `?olderThanDays=${olderThanDays}` : '';
    const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-logs${params}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.error('API Error deleteAllMcpLogs', e);
    return false;
  }
};

/** Fetch current MCP server enabled state. */
export const getMcpEnabled = async (): Promise<{ enabled: boolean }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/mcp-enabled`);
  if (!res.ok) throw new Error('Failed to fetch MCP enabled state');
  return res.json();
};

/** Enable or disable the MCP server. */
export const patchMcpEnabled = async (enabled: boolean): Promise<{ enabled: boolean }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/mcp-enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to update MCP enabled state');
  return res.json();
};
