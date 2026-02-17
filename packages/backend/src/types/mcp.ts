export interface McpServerConfig {
  upstream_url: string;
  enabled: boolean;
  headers?: Record<string, string>;
}

export interface McpRequestUsage {
  id?: number;
  request_id: string;
  created_at: string;
  start_time: number;
  duration_ms: number | null;
  server_name: string;
  upstream_url: string;
  method: 'POST' | 'GET' | 'DELETE';
  jsonrpc_method: string | null;
  api_key: string | null;
  attribution: string | null;
  source_ip: string | null;
  response_status: number | null;
  is_streamed: boolean;
  has_debug: boolean;
  error_code: string | null;
  error_message: string | null;
}

export interface McpDebugLog {
  id?: number;
  request_id: string;
  raw_request_headers: string | null;
  raw_request_body: string | null;
  raw_response_headers: string | null;
  raw_response_body: string | null;
  created_at: string;
}

export interface McpProxyRequest {
  serverName: string;
  method: 'POST' | 'GET' | 'DELETE';
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface McpProxyResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: ReadableStream<Uint8Array>;
}
