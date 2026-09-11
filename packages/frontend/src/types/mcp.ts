export type McpServer = RemoteMcpServer | LocalMcpServer;

export interface RemoteMcpServer {
  mode?: 'remote_http';
  upstream_url: string;
  enabled: boolean;
  headers?: Record<string, string>;
  auth_scheme?: string | null;
  rate_limit_cooldown_ms?: number;
  quota_cooldown_ms?: number;
}

export interface LocalMcpServer {
  mode: 'local_http';
  enabled: boolean;
  launcher: 'bunx' | 'uvx';
  package: string;
  args?: string[];
  env?: Record<string, string>;
  port: number;
  path?: string;
  startup_timeout_ms?: number;
  headers?: Record<string, string>;
  auth_scheme?: string | null;
  rate_limit_cooldown_ms?: number;
  quota_cooldown_ms?: number;
}

export interface McpServerKey {
  id: number;
  key: string;
  is_active: boolean;
  cooldown_until: string | null;
}

export interface LocalMcpRuntimeStatus {
  serverName: string;
  status: 'stopped' | 'starting' | 'running' | 'failed';
  pid: number | null;
  url: string | null;
  lastError: string | null;
  startedAt: string | null;
  exitedAt: string | null;
}

export interface McpLogRecord {
  request_id: string;
  created_at: string;
  start_time: number;
  duration_ms: number | null;
  server_name: string;
  upstream_url: string;
  method: 'POST' | 'GET' | 'DELETE';
  jsonrpc_method: string | null;
  tool_name: string | null;
  api_key: string | null;
  attribution: string | null;
  source_ip: string | null;
  response_status: number | null;
  is_streamed: boolean;
  has_debug: boolean;
  error_code: string | null;
  error_message: string | null;
}

export interface McpOAuthSettings {
  enabled: boolean;
  provider: 'plexus-idp';
  issuer?: string;
}

export interface McpOAuthTokenRecord {
  id: number;
  accessTokenHash: string;
  refreshTokenHash: string;
  clientId: string;
  keyName: string;
  apiKeySecretHash: string | null;
  resource: string;
  scope: string | null;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  revokedAt: number | null;
  createdAt: number;
}

export interface McpOAuthClientRecord {
  clientId: string;
  clientName: string | null;
  status: 'active' | 'disabled';
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope: string | null;
  tokenEndpointAuthMethod: string;
  createdAt: number;
  tokens: McpOAuthTokenRecord[];
}
