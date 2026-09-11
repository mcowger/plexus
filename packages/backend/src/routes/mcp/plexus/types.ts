import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const ToolInputSchema = {
  operation: z
    .string()
    .min(1)
    .describe('Operation to perform, such as list, get, status, or summary.'),
  id: z
    .string()
    .optional()
    .describe(
      'Optional resource identifier for get/update/delete operations (the key name for plexus_quota status).'
    ),
  category: z.string().optional().describe('Optional settings or subdomain category.'),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional filters, pagination, or sort options.'),
  body: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional payload for mutating operations.'),
  destructive: z
    .string()
    .optional()
    .describe('Must be exactly "acknowledged" for destructive or high-impact operations.'),
  redact: z
    .boolean()
    .optional()
    .describe('Defaults to true. redact: false is only honored by explicitly authorized handlers.'),
};

export type ToolInput = {
  operation: string;
  id?: string;
  category?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  destructive?: string;
  redact?: boolean;
};

export type ToolResponse = {
  ok: boolean;
  operation: string;
  data?: unknown;
  error?: {
    message: string;
    type: string;
    code: number;
  };
};

export type ManagementShimContext = {
  fastify: FastifyInstance;
  headers: Record<string, string>;
};

export type PlexusToolName =
  | 'plexus_config'
  | 'plexus_provider'
  | 'plexus_model_alias'
  | 'plexus_key'
  | 'plexus_quota'
  | 'plexus_quota_checker'
  | 'plexus_usage'
  | 'plexus_debug'
  | 'plexus_mcp_gateway'
  | 'plexus_settings'
  | 'plexus_system_logs'
  | 'plexus_operations';

export class McpToolError extends Error {
  type: string;
  code: number;

  constructor(message: string, type: string, code: number) {
    super(message);
    this.type = type;
    this.code = code;
  }
}
