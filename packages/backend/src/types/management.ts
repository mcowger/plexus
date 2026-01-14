// === Config API Types ===
export interface ConfigGetResponse {
  config: string;                 // Raw YAML content
  lastModified: string;           // ISO timestamp
  checksum: string;               // SHA-256 for change detection
}

export interface ConfigUpdateRequest {
  config: string;                 // New YAML content
  validate?: boolean;             // Validate before applying (default: true)
  reload?: boolean;               // Hot reload after save (default: true)
}

export interface ConfigUpdateResponse {
  success: boolean;
  message: string;
  validationErrors?: string[];
  previousChecksum: string;
  newChecksum: string;
}

// === State API Types ===
export interface CooldownEntry {
  provider: string;
  reason: string;
  endTime: number;
  remaining: number;
}

export interface StateGetResponse {
  debug: {
    enabled: boolean;
    captureRequests: boolean;
    captureResponses: boolean;
  };
  cooldowns: CooldownEntry[];
  providers: {
    name: string;
    enabled: boolean;
    healthy: boolean;
    cooldownRemaining?: number;
    metrics?: {
      avgLatency: number;
      successRate: number;
      requestsLast5Min: number;
    };
  }[];
  uptime: number;                 // Seconds since start
  version: string;
}

export type StateAction = 
  | { action: "set-debug"; payload: { enabled: boolean } }
  | { action: "clear-cooldowns"; payload?: { provider?: string } }
  | { action: "disable-provider"; payload: { provider: string } }
  | { action: "enable-provider"; payload: { provider: string } };

export interface StateUpdateResponse {
  success: boolean;
  message: string;
  state: StateGetResponse;
}

// === Logs API Types ===
export type LogType = "usage" | "error" | "trace";

export interface LogsQuery {
  type?: LogType;                 // Default: usage
  limit?: number;                 // Default: 100, max: 1000
  offset?: number;                // For pagination
  provider?: string;              // Filter by provider
  model?: string;                 // Filter by model
  apiKey?: string;                // Filter by API key name
  success?: boolean;              // Filter by success status
  startDate?: string;             // ISO timestamp
  endDate?: string;               // ISO timestamp
}

// We need to import these from existing types or redefine them if they are internal
// Importing from usage.ts assuming they are exported there
import type { UsageLogEntry, ErrorLogEntry } from "./usage";
import type { DebugTraceEntry } from "./debug";

export interface LogsListResponse {
  type: LogType;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  entries: UsageLogEntry[] | ErrorLogEntry[] | DebugTraceEntry[];
}

export interface LogDetailResponse {
  usage: UsageLogEntry | null;
  errors?: ErrorLogEntry[] | null;
  traces?: DebugTraceEntry[] | null;       // Debug captures
}

export interface LogsDeleteRequest {
  type?: LogType;                 // Delete specific type
  olderThanDays?: number;         // Delete by age
  all?: boolean;                  // Delete everything
}

export interface LogsDeleteResponse {
  success: boolean;
  deleted: {
    usage: number;
    error: number;
    trace: number;
  };
}

// === Events API Types ===
export type EventType = 
  | "usage"                       // Request completed
  | "syslog"                      // System log message
  | "state_change"                // Cooldown/debug change
  | "config_change";              // Configuration updated

export interface SSEEvent {
  type: EventType;
  timestamp: string;
  data: unknown;
}

export interface UsageEvent {
  type: "usage";
  data: {
    requestId: string;
    alias: string;
    provider: string;
    model: string;
    success: boolean;
    tokens: number;
    cost: number;
    duration: number;
  };
}

export interface StateChangeEvent {
  type: "state_change";
  data: {
    change: "cooldown_set" | "cooldown_cleared" | "debug_toggled" | "provider_toggled";
    provider?: string;
    details: unknown;
  };
}

export interface ConfigChangeEvent {
  type: "config_change";
  data: {
    previousChecksum: string;
    newChecksum: string;
    changedSections: string[];
  };
}
