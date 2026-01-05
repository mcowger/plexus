import { FastifyInstance } from 'fastify';
import { getConfig } from '../../config';

export async function registerModelsRoute(fastify: FastifyInstance) {
    /**
     * GET /v1/models
     * Returns a list of available model aliases configured in plexus.yaml.
     * Matches the OpenAI models list format.
     */
    fastify.get('/v1/models', async (request, reply) => {
        const config = getConfig();
        const modelIds = new Set<string>();

        Object.entries(config.models).forEach(([id, modelConfig]) => {
            modelIds.add(id);
            if (modelConfig.additional_aliases) {
                modelConfig.additional_aliases.forEach(alias => modelIds.add(alias));
            }
        });

        const models = Array.from(modelIds).map(id => ({
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'plexus'
        }));
        
        return reply.send({
            object: 'list',
            data: models
        });
    });
}
