import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { logger } from '../utils/logger';

export const FALLBACK_PROVIDERS = [
  { name: 'fallback-chat', definition: JSON.stringify({ api: 'openai-completions' }) },
  { name: 'fallback-responses', definition: JSON.stringify({ api: 'openai-responses' }) },
  { name: 'fallback-anthropic', definition: JSON.stringify({ api: 'anthropic-messages' }) },
  { name: 'fallback-gemini', definition: JSON.stringify({ api: 'google-generative-ai' }) },
];

export async function seedFallbackProviders() {
  try {
    const db = getDatabase();
    const schema = getSchema();

    // Check if piAiCustomProviders exists in the schema (it should)
    if (!schema || !schema.piAiCustomProviders) {
      logger.warn('piAiCustomProviders table not found in schema, skipping seed');
      return;
    }

    const customProvidersTable = schema.piAiCustomProviders;
    const now = Math.floor(Date.now() / 1000);

    for (const provider of FALLBACK_PROVIDERS) {
      const existing = await db
        .select()
        .from(customProvidersTable)
        .where(eq(customProvidersTable.name, provider.name))
        .limit(1);

      if (!existing || existing.length === 0) {
        await db.insert(customProvidersTable).values({
          name: provider.name,
          definition: provider.definition,
          createdAt: now,
          updatedAt: now,
        });
        logger.debug(`Seeded fallback provider: ${provider.name}`);
      }
    }
  } catch (error) {
    logger.error('Failed to seed fallback providers', error);
  }
}
