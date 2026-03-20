import { relations } from 'drizzle-orm';
import { providers } from './providers';
import { providerModels } from './provider-models';
import { modelAliases } from './model-aliases';
import { modelAliasTargets } from './model-alias-targets';
import { oauthCredentials } from './oauth-credentials';

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

export const modelAliasesRelations = relations(modelAliases, ({ many }) => ({
  targets: many(modelAliasTargets),
}));

export const modelAliasTargetsRelations = relations(modelAliasTargets, ({ one }) => ({
  alias: one(modelAliases, {
    fields: [modelAliasTargets.aliasId],
    references: [modelAliases.id],
  }),
}));
