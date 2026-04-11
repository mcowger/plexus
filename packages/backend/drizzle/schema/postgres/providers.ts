import {
  pgTable,
  serial,
  text,
  real,
  integer,
  boolean,
  bigint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { oauthCredentials } from './oauth-credentials';
import { oauthProviderTypeEnum, quotaCheckerTypeEnum } from './enums';

export { oauthProviderTypeEnum, quotaCheckerTypeEnum };

export const providers = pgTable(
  'providers',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name'),
    apiBaseUrl: jsonb('api_base_url'), // String URL or {"chat":"...","messages":"..."}
    apiKey: text('api_key'),
    oauthProviderType: oauthProviderTypeEnum('oauth_provider_type'),
    oauthCredentialId: integer('oauth_credential_id').references(() => oauthCredentials.id, {
      onDelete: 'set null',
    }),
    enabled: boolean('enabled').notNull().default(true),
    disableCooldown: boolean('disable_cooldown').notNull().default(false),
    discount: real('discount'),
    estimateTokens: boolean('estimate_tokens').notNull().default(false),
    useClaudeMasking: boolean('use_claude_masking').notNull().default(false),
    headers: text('headers'), // JSON or encrypted string — text for encryption compatibility
    extraBody: text('extra_body'), // JSON — not encrypted, text for consistency
    quotaCheckerType: quotaCheckerTypeEnum('quota_checker_type'),
    quotaCheckerId: text('quota_checker_id'),
    quotaCheckerEnabled: boolean('quota_checker_enabled').notNull().default(true),
    quotaCheckerInterval: integer('quota_checker_interval').notNull().default(30),
    quotaCheckerOptions: text('quota_checker_options'), // JSON or encrypted string
    // GPU Profile settings for inference energy calculation
    gpuProfile: text('gpu_profile'), // 'H100' | 'H200' | 'GH100' | 'GH200' | 'B200' | 'B300' | 'custom'
    gpuRamGb: real('gpu_ram_gb'), // Custom RAM override in GB
    gpuBandwidthTbS: real('gpu_bandwidth_tb_s'), // Custom bandwidth override in TB/s
    gpuFlopsTflop: real('gpu_flops_tflop'), // Custom FLOPS override in TFLOP
    gpuPowerDrawWatts: integer('gpu_power_draw_watts'), // Custom power draw override in watts
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    slugIdx: index('idx_providers_slug').on(table.slug),
  })
);
