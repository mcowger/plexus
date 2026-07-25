import { z } from 'zod';

export const McpServerSettingsSchema = z.object({
  auth_scheme: z.string().trim().min(1).nullable().optional(),
  rate_limit_cooldown_ms: z.number().int().min(0).default(60_000).optional(),
  quota_cooldown_ms: z.number().int().min(0).default(86_400_000).optional(),
});

export const RemoteHttpMcpServerConfigSchema = z
  .object({
    mode: z.literal('remote_http').default('remote_http').optional(),
    upstream_url: z.string().url(),
    enabled: z.boolean().default(true),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .extend(McpServerSettingsSchema.shape);

export const LocalHttpMcpServerConfigSchema = z
  .object({
    mode: z.literal('local_http'),
    enabled: z.boolean().default(true),
    launcher: z.enum(['bunx', 'uvx']),
    package: z.string().trim().min(1),
    args: z.array(z.string()).default([]).optional(),
    env: z.record(z.string(), z.string()).default({}).optional(),
    port: z.number().int().min(1).max(65_535),
    path: z.string().trim().min(1).default('/mcp').optional(),
    startup_timeout_ms: z.number().int().min(1_000).max(300_000).default(30_000).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .extend(McpServerSettingsSchema.shape);

export const McpServerConfigSchema = z.union([
  LocalHttpMcpServerConfigSchema,
  RemoteHttpMcpServerConfigSchema,
]);

export const McpKeyCreateSchema = z.object({
  key: z.string().trim().min(1),
  is_active: z.boolean().default(true).optional(),
});

export const McpKeySchema = z.object({
  id: z.number().int(),
  key: z.string(),
  is_active: z.boolean(),
  cooldown_until: z.string().datetime().nullable(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpKeyCreate = z.infer<typeof McpKeyCreateSchema>;
export type McpKey = z.infer<typeof McpKeySchema>;
