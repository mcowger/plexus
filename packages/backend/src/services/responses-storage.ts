import { getDatabase, getSchema } from '../db/client';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { UnifiedResponsesResponse } from '../types/responses';

export class ResponsesStorageService {
  private db: ReturnType<typeof getDatabase> | null = null;
  private schema: any = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Response Storage with Automatic TTL Cleanup
   *
   * Storage Duration:
   * - Responses are retained for a configurable TTL (default: 7 days)
   * - Automatic cleanup runs hourly via startCleanupJob()
   * - Supports previous_response_id for true stateless multi-turn conversations
   *
   * Data Retention:
   * - Responses and their output items are deleted after TTL
   * - Orphaned conversations (no remaining responses) are also cleaned up
   * - TTL can be customized per cleanup job invocation
   *
   * Cleanup Behavior:
   * - First cleanup runs on startCleanupJob() call (initial sweep)
   * - Subsequent cleanups run at the specified interval
   * - Logs statistics when deletions occur
   */
  startCleanupJob(intervalHours: number = 24, ttlDays: number = 7): void {
    if (this.cleanupInterval) {
      logger.warn('Response cleanup job already running');
      return;
    }

    // Run initial cleanup
    this.cleanupOldResponses(ttlDays).catch(err => logger.error('Initial response cleanup failed:', err));

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(async () => {
      try {
        const result = await this.cleanupOldResponses(ttlDays);
        if (result.deletedResponses > 0) {
          logger.info(`Scheduled cleanup: deleted ${result.deletedResponses} responses, ${result.deletedItems} items, ${result.deletedConversations} conversations`);
        }
      } catch (err) {
        logger.error('Scheduled response cleanup failed:', err);
      }
    }, intervalHours * 60 * 60 * 1000);

    logger.info(`Response cleanup job started (every ${intervalHours}h, TTL ${ttlDays} days)`);
  }

  /**
   * Stop the cleanup job
   */
  stopCleanupJob(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Response cleanup job stopped');
    }
  }

  private ensureDb() {
    if (!this.db) {
      this.db = getDatabase();
      this.schema = getSchema();
    }
    return this.db;
  }

  /**
   * Stores a response in the database
   *
   * previous_response_id Linking:
   * - Stores the reference to enable subsequent requests to load prior context
   * - This linkage is what allows the /v1/responses endpoint to provide true
   *   stateless multi-turn conversations - the client only needs to send the
   *   new input and the previous_response_id, not all conversation history
   */
  async storeResponse(response: UnifiedResponsesResponse, request: any): Promise<void> {
    try {
      const db = this.ensureDb();
      const responseRecord = {
        id: response.id,
        object: 'response',
        createdAt: response.created_at,
        completedAt: response.completed_at || null,
        status: response.status,
        model: response.model,
        outputItems: JSON.stringify(response.output),
        instructions: request.instructions || null,
        temperature: request.temperature ?? null,
        topP: request.top_p ?? null,
        maxOutputTokens: request.max_output_tokens ?? null,
        topLogprobs: request.top_logprobs ?? null,
        parallelToolCalls: request.parallel_tool_calls ? 1 : 0,
        toolChoice: request.tool_choice ? JSON.stringify(request.tool_choice) : null,
        tools: request.tools ? JSON.stringify(request.tools) : null,
        textConfig: request.text ? JSON.stringify(request.text) : null,
        reasoningConfig: request.reasoning ? JSON.stringify(request.reasoning) : null,
        usageInputTokens: response.usage?.input_tokens || 0,
        usageOutputTokens: response.usage?.output_tokens || 0,
        usageReasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens || 0,
        usageCachedTokens: response.usage?.input_tokens_details?.cached_tokens || 0,
        usageTotalTokens: response.usage?.total_tokens || 0,
        previousResponseId: request.previous_response_id || null,
        conversationId: typeof request.conversation === 'string' 
          ? request.conversation 
          : request.conversation?.id || null,
        store: request.store !== false ? 1 : 0,
        background: request.background ? 1 : 0,
        truncation: request.truncation || 'disabled',
        incompleteDetails: response.incomplete_details ? JSON.stringify(response.incomplete_details) : null,
        error: response.error ? JSON.stringify(response.error) : null,
        safetyIdentifier: request.safety_identifier || null,
        serviceTier: request.service_tier || 'auto',
        promptCacheKey: request.prompt_cache_key || null,
        promptCacheRetention: request.prompt_cache_retention || null,
        metadata: request.metadata ? JSON.stringify(request.metadata) : null,
        plexusProvider: response.plexus?.provider || null,
        plexusTargetModel: response.plexus?.model || null,
        plexusApiType: response.plexus?.apiType || null,
        plexusCanonicalModel: response.plexus?.canonicalModel || null,
      };

      await db.insert(this.schema.responses).values(responseRecord);

      // Store individual output items for efficient querying
      if (response.output && response.output.length > 0) {
        for (let i = 0; i < response.output.length; i++) {
          const item = response.output[i];
          if (item) {
            await db.insert(this.schema.responseItems).values({
              id: item.id || `item_${response.id}_${i}`,
              responseId: response.id,
              itemIndex: i,
              itemType: item.type,
              itemData: JSON.stringify(item)
            });
          }
        }
      }

      logger.debug(`Stored response ${response.id}`);
    } catch (error) {
      logger.error('Error storing response:', error);
      throw error;
    }
  }

  /**
   * Retrieves a response from the database
   */
  async getResponse(responseId: string): Promise<any | null> {
    try {
      const db = this.ensureDb();
      const results = await db
        .select()
        .from(this.schema.responses)
        .where(eq(this.schema.responses.id, responseId))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error(`Error retrieving response ${responseId}:`, error);
      throw error;
    }
  }

  /**
   * Deletes a response from the database
   */
  async deleteResponse(responseId: string): Promise<boolean> {
    try {
      const db = this.ensureDb();
      
      // Delete response items first
      await db
        .delete(this.schema.responseItems)
        .where(eq(this.schema.responseItems.responseId, responseId));

      // Delete response
      await db
        .delete(this.schema.responses)
        .where(eq(this.schema.responses.id, responseId));

      logger.debug(`Deleted response ${responseId}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting response ${responseId}:`, error);
      throw error;
    }
  }

  /**
   * Creates or updates a conversation
   */
  async updateConversation(
    conversationId: string,
    outputItems: any[],
    inputItems: any[]
  ): Promise<void> {
    try {
      const db = this.ensureDb();
      
      // Check if conversation exists
      const existing = await db
        .select()
        .from(this.schema.conversations)
        .where(eq(this.schema.conversations.id, conversationId))
        .limit(1);

      const now = Math.floor(Date.now() / 1000);
      const allItems = [...inputItems, ...outputItems];

      if (existing.length === 0) {
        // Create new conversation
        await db.insert(this.schema.conversations).values({
          id: conversationId,
          createdAt: now,
          updatedAt: now,
          items: JSON.stringify(allItems),
          metadata: null,
          plexusAccountId: null
        });
        logger.debug(`Created conversation ${conversationId}`);
      } else {
        // Update existing conversation
        const existingItems = JSON.parse(existing[0]?.items || '[]');
        const updatedItems = [...existingItems, ...allItems];

        await db
          .update(this.schema.conversations)
          .set({
            updatedAt: now,
            items: JSON.stringify(updatedItems)
          })
          .where(eq(this.schema.conversations.id, conversationId));
        
        logger.debug(`Updated conversation ${conversationId}`);
      }
    } catch (error) {
      logger.error(`Error updating conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves a conversation from the database
   */
  async getConversation(conversationId: string): Promise<any | null> {
    try {
      const db = this.ensureDb();
      const results = await db
        .select()
        .from(this.schema.conversations)
        .where(eq(this.schema.conversations.id, conversationId))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error(`Error retrieving conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Deletes responses and their associated items/conversations older than TTL
   * Default TTL: 7 days
   */
  async cleanupOldResponses(ttlDays: number = 7): Promise<{ deletedResponses: number; deletedItems: number; deletedConversations: number }> {
    try {
      const db = this.ensureDb();
      const cutoffTime = Date.now() - (ttlDays * 24 * 60 * 60 * 1000);

      // Find old response IDs
      const oldResponses = await db
        .select({ id: this.schema.responses.id })
        .from(this.schema.responses)
        .where(this.schema.responses.createdAt.lt(cutoffTime));

      const responseIds = oldResponses.map(r => r.id);

      if (responseIds.length === 0) {
        return { deletedResponses: 0, deletedItems: 0, deletedConversations: 0 };
      }

      // Delete response items
      await db
        .delete(this.schema.responseItems)
        .where(this.schema.responseItems.responseId.in(responseIds));

      // Delete responses
      await db
        .delete(this.schema.responses)
        .where(this.schema.responses.id.in(responseIds));

      // Find and delete orphaned conversations (no responses referencing them)
      const conversationIdsToDelete = await db
        .select({ id: this.schema.conversations.id })
        .from(this.schema.conversations)
        .leftJoin(this.schema.responses, eq(this.schema.responses.conversationId, this.schema.conversations.id))
        .where(sql`${this.schema.responses.id} IS NULL`);

      const orphanedIds = conversationIdsToDelete.map(c => c.id);
      let deletedConversations = 0;
      if (orphanedIds.length > 0) {
        await db
          .delete(this.schema.conversations)
          .where(this.schema.conversations.id.in(orphanedIds));
        deletedConversations = orphanedIds.length;
      }

      logger.info(`Cleanup: deleted ${responseIds.length} responses, ${responseIds.length} items, ${deletedConversations} orphaned conversations`);
      return { deletedResponses: responseIds.length, deletedItems: responseIds.length, deletedConversations };
    } catch (error) {
      logger.error('Error cleaning up old responses:', error);
      throw error;
    }
  }

  /**
   * Formats stored response for API output
   */
  formatStoredResponse(row: any): any {
    return {
      id: row.id,
      object: row.object,
      created_at: row.createdAt,
      completed_at: row.completedAt,
      status: row.status,
      model: row.model,
      output: JSON.parse(row.outputItems),
      instructions: row.instructions,
      temperature: row.temperature,
      top_p: row.topP,
      max_output_tokens: row.maxOutputTokens,
      top_logprobs: row.topLogprobs,
      parallel_tool_calls: row.parallelToolCalls === 1,
      tool_choice: row.toolChoice ? JSON.parse(row.toolChoice) : undefined,
      tools: row.tools ? JSON.parse(row.tools) : [],
      text: row.textConfig ? JSON.parse(row.textConfig) : undefined,
      reasoning: row.reasoningConfig ? JSON.parse(row.reasoningConfig) : undefined,
      usage: {
        input_tokens: row.usageInputTokens,
        input_tokens_details: {
          cached_tokens: row.usageCachedTokens
        },
        output_tokens: row.usageOutputTokens,
        output_tokens_details: {
          reasoning_tokens: row.usageReasoningTokens
        },
        total_tokens: row.usageTotalTokens
      },
      previous_response_id: row.previousResponseId,
      conversation: row.conversationId ? { id: row.conversationId } : null,
      store: row.store === 1,
      background: row.background === 1,
      truncation: row.truncation,
      incomplete_details: row.incompleteDetails ? JSON.parse(row.incompleteDetails) : null,
      error: row.error ? JSON.parse(row.error) : null,
      safety_identifier: row.safetyIdentifier,
      service_tier: row.serviceTier,
      prompt_cache_key: row.promptCacheKey,
      prompt_cache_retention: row.promptCacheRetention,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      plexus: {
        provider: row.plexusProvider,
        model: row.plexusTargetModel,
        apiType: row.plexusApiType,
        canonicalModel: row.plexusCanonicalModel
      }
    };
  }

  /**
   * Formats stored conversation for API output
   */
  formatStoredConversation(row: any): any {
    return {
      id: row.id,
      object: 'conversation',
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      items: JSON.parse(row.items),
      metadata: row.metadata ? JSON.parse(row.metadata) : {}
    };
  }
}
