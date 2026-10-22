import { relations } from 'drizzle-orm';

import { aliasMetadataOverrides } from './alias-metadata-overrides';
import { modelAliasTargets } from './model-alias-targets';
import { modelAliases } from './model-aliases';
import { oauthCredentials } from './oauth-credentials';
import { providerModels } from './provider-models';
import { providers } from './providers';

export const providersRelations = relations(providers, ({ many, one }) => ({
  models: many(providerModels),
  oauthCredential: one(oauthCredentials, {
    fields: [providers.oauthCredentialId],
    references: [oauthCredentials.id],
  }),
}));

export const providerModelsRelations = relations(providerModels, ({ one }) => ({
  provider: one(providers, {
    fields: [providerModels.providerId],
    references: [providers.id],
  }),
}));

export const modelAliasesRelations = relations(modelAliases, ({ many, one }) => ({
  targets: many(modelAliasTargets),
  metadataOverride: one(aliasMetadataOverrides, {
    fields: [modelAliases.id],
    references: [aliasMetadataOverrides.aliasId],
  }),
}));

export const modelAliasTargetsRelations = relations(modelAliasTargets, ({ one }) => ({
  alias: one(modelAliases, {
    fields: [modelAliasTargets.aliasId],
    references: [modelAliases.id],
  }),
}));

export const aliasMetadataOverridesRelations = relations(aliasMetadataOverrides, ({ one }) => ({
  alias: one(modelAliases, {
    fields: [aliasMetadataOverrides.aliasId],
    references: [modelAliases.id],
  }),
}));
