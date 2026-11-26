import { z } from 'zod';

export const MCP_UPSTREAM_OAUTH_CALLBACK_PATH = '/oauth/mcp-upstream/callback';
export const MCP_UI_PATH = '/ui/mcp';
export const MCP_LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

export function isMcpOAuthTransport(url: URL): boolean {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && MCP_LOOPBACK_HOSTNAMES.includes(url.hostname))
  );
}

export function parseMcpOAuthUrl(value: string): URL | null {
  const url = URL.parse(value);
  if (!url || url.username || url.password || url.hash || !isMcpOAuthTransport(url)) return null;
  return url;
}

export function getMcpUpstreamOAuthCallbackUrl(origin: string | undefined): URL | null {
  if (!origin) return null;
  const url = URL.parse(origin);
  if (!url || url.origin !== origin || !isMcpOAuthTransport(url)) return null;
  return new URL(MCP_UPSTREAM_OAUTH_CALLBACK_PATH, url);
}

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
    oauth: z
      .object({
        client: z.string().trim().min(1).optional(),
        scopes: z.array(z.string().trim().min(1).regex(/^\S+$/)).optional(),
      })
      .optional(),
  })
  .extend(McpServerSettingsSchema.shape)
  .superRefine((config, ctx) => {
    if (!config.oauth) return;
    if (config.auth_scheme) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth_scheme'],
        message: 'OAuth cannot be combined with auth_scheme',
      });
    }
    if (Object.keys(config.headers ?? {}).some((name) => name.toLowerCase() === 'authorization')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headers'],
        message: 'OAuth cannot be combined with an Authorization header',
      });
    }
  });

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
  .extend(McpServerSettingsSchema.shape)
  .transform((config) => {
    if (!config.env) return config;
    const env = Object.fromEntries(
      Object.entries(config.env).filter(([key]) => key.toUpperCase() !== 'MCP_DATA_DIR')
    );
    return { ...config, env };
  });

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
