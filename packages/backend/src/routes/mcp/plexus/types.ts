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

const ModelAliasTargetInputSchema = z
  .object({
    alias: z
      .string()
      .min(1)
      .optional()
      .describe('Slug of another model alias to use as this target.'),
    provider: z.string().optional().describe('Provider slug for a concrete provider/model target.'),
    model: z.string().optional().describe('Provider model ID for a concrete target.'),
    enabled: z.boolean().optional().describe('Set false to skip this target.'),
    auto_profile: z
      .object({
        capability: z.enum(['economy', 'standard', 'high', 'premium']).optional(),
        specialties: z
          .array(
            z.enum([
              'plan',
              'implement',
              'debug',
              'refactor',
              'review',
              'research',
              'explain',
              'operate',
              'write',
              'chat',
            ])
          )
          .optional()
          .describe(
            'Task specialties for auto routing. A requested use case belongs here, not in a use_case field.'
          ),
        reasoning: z.enum(['normal', 'preferred']).optional(),
      })
      .optional()
      .describe(
        'Per-target auto-routing profile. Specialties are task kinds such as plan, debug, review, implement, refactor, write, or chat.'
      ),
  })
  .passthrough()
  .describe(
    'Specify either alias, or both provider and model. Alias targets expand another configured alias.'
  );

const ModelAliasBodyInputSchema = z
  .object({
    target_groups: z
      .array(
        z
          .object({
            name: z.string().optional().describe('Group label, such as premium, high, or economy.'),
            selector: z
              .enum([
                'random',
                'in_order',
                'cost',
                'latency',
                'usage',
                'quota',
                'performance',
                'e2e_performance',
                'auto',
              ])
              .optional()
              .describe(
                'Selection strategy. Use auto for classifier-based task routing; other selectors choose targets by their named strategy.'
              ),
            targets: z.array(ModelAliasTargetInputSchema).optional(),
          })
          .passthrough()
      )
      .optional()
      .describe(
        'Ordered target groups. For selector=auto, the auto-routing classifier chooses among qualified targets.'
      ),
    type: z
      .enum(['text', 'embeddings', 'transcriptions', 'speech', 'image', 'decisions'])
      .optional()
      .describe(
        'Alias capability. decisions marks an alias usable for Decisions API calls; it does not select targets. Use selector=auto with auto_routing for classifier-based model selection.'
      ),
    priority: z.enum(['selector', 'api_match']).optional(),
    additional_aliases: z.array(z.string()).optional(),
    use_image_fallthrough: z.boolean().optional(),
    enforce_limits: z.boolean().optional(),
    sticky_session: z.boolean().optional(),
    preferred_api: z
      .array(z.enum(['chat_completions', 'messages', 'gemini', 'responses']))
      .optional(),
    metadata: z
      .object({
        source: z
          .enum(['auto', 'disabled', 'openrouter', 'models.dev', 'catwalk', 'custom'])
          .describe('Metadata source.'),
        source_path: z
          .string()
          .optional()
          .describe('Catalog entry path required by openrouter, models.dev, and catwalk sources.'),
        overrides: z
          .object({
            name: z.string().optional(),
            description: z.string().optional(),
            context_length: z.number().optional(),
            pricing: z
              .object({
                prompt: z.string().optional(),
                completion: z.string().optional(),
                input_cache_read: z.string().optional(),
                input_cache_write: z.string().optional(),
              })
              .passthrough()
              .optional(),
            architecture: z
              .object({
                input_modalities: z.array(z.string()).optional(),
                output_modalities: z.array(z.string()).optional(),
                tokenizer: z.string().optional(),
              })
              .passthrough()
              .optional(),
            supported_parameters: z.array(z.string()).optional(),
            top_provider: z
              .object({
                context_length: z.number().optional(),
                max_completion_tokens: z.number().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional()
          .describe('Fields to override on the published model card.'),
      })
      .passthrough()
      .optional()
      .describe(
        'Published model metadata. Use {source:"auto",overrides:{...}} for catalog-derived metadata with overrides, or {source:"custom",overrides:{name,...}} for a fully custom model card.'
      ),
    auto_routing: z
      .object({
        mode: z.enum(['off', 'active']).optional(),
        classifier_alias: z
          .string()
          .optional()
          .describe('Alias used to classify requests; it must be a Decisions-capable alias.'),
      })
      .passthrough()
      .optional()
      .describe(
        'Alias-level policy for selector=auto groups. Active mode requires classifier_alias and qualified enabled targets.'
      ),
    pi_model: z.object({ provider: z.string(), model_id: z.string() }).optional(),
    extraBody: z.record(z.string(), z.unknown()).optional(),
    synthetic_safeguard_approval: z.boolean().optional(),
    advanced: z.array(z.record(z.string(), z.unknown())).optional(),
    compaction: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .describe(
    'Model alias configuration. Fields are optional for PATCH/update. Unknown fields pass through to the management API.'
  );

export const ModelAliasToolInputSchema = {
  ...ToolInputSchema,
  id: z
    .string()
    .optional()
    .describe(
      'Alias slug. Required for put/create/update/delete; for put/create it becomes the new alias ID. Also required for get.'
    ),
  body: ModelAliasBodyInputSchema.optional().describe(
    'Alias configuration. Targets may be concrete provider/model pairs or references to other aliases.'
  ),
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
