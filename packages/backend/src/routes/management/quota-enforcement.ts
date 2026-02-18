import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Register admin API endpoints for quota enforcement management.
 */
export async function registerQuotaEnforcementRoutes(fastify: FastifyInstance, quotaEnforcer: QuotaEnforcer) {
    
    /**
     * POST /v0/management/quota/clear
     * Reset quota usage for a key.
     */
    fastify.post('/v0/management/quota/clear', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const body = request.body as { key: string };
            
            if (!body.key) {
                return reply.code(400).send({
                    error: {
                        message: 'Missing required field: key',
                        type: 'invalid_request_error'
                    }
                });
            }

            await quotaEnforcer.clearQuota(body.key);

            return reply.send({
                success: true,
                key: body.key,
                message: 'Quota reset successfully'
            });
        } catch (error: any) {
            logger.error('[QuotaEnforcement] Error clearing quota:', error);
            return reply.code(500).send({
                error: {
                    message: error.message || 'Internal server error',
                    type: 'server_error'
                }
            });
        }
    });

    /**
     * GET /v0/management/quota/status/:key
     * Get current quota status for a key.
     */
    fastify.get('/v0/management/quota/status/:key', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { key } = request.params as { key: string };
            
            if (!key) {
                return reply.code(400).send({
                    error: {
                        message: 'Missing required parameter: key',
                        type: 'invalid_request_error'
                    }
                });
            }

            const config = getConfig();
            const keyConfig = config.keys?.[key];

            // Key not found
            if (!keyConfig) {
                return reply.code(404).send({
                    error: {
                        message: `Key not found: ${key}`,
                        type: 'not_found_error'
                    }
                });
            }

            // No quota assigned
            if (!keyConfig.quota) {
                return reply.send({
                    key,
                    quota_name: null,
                    allowed: true,
                    current_usage: 0,
                    limit: null,
                    remaining: null,
                    resets_at: null
                });
            }

            // Get quota status
            const result = await quotaEnforcer.checkQuota(key);

            if (!result) {
                return reply.send({
                    key,
                    quota_name: keyConfig.quota,
                    allowed: true,
                    current_usage: 0,
                    limit: null,
                    remaining: null,
                    resets_at: null
                });
            }

            return reply.send({
                key,
                quota_name: result.quotaName,
                allowed: result.allowed,
                current_usage: result.currentUsage,
                limit: result.limit,
                remaining: result.remaining,
                resets_at: result.resetsAt?.toISOString() ?? null
            });
        } catch (error: any) {
            logger.error('[QuotaEnforcement] Error getting quota status:', error);
            return reply.code(500).send({
                error: {
                    message: error.message || 'Internal server error',
                    type: 'server_error'
                }
            });
        }
    });
}
