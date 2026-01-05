import { describe, it, expect } from 'bun:test';
import Fastify from 'fastify';
import { registerModelsRoute } from '../models';
import { setConfigForTesting, PlexusConfig } from '../../../config';

describe('GET /v1/models', () => {
    it('should return primary and additional aliases', async () => {
        const fastify = Fastify();
        await registerModelsRoute(fastify);

        const mockConfig = {
            models: {
                'gpt-4': {
                    targets: [],
                    additional_aliases: ['gpt-4-alias', 'my-gpt']
                },
                'claude-3': {
                    targets: []
                    // No additional aliases
                }
            }
        } as unknown as PlexusConfig;

        setConfigForTesting(mockConfig);

        const response = await fastify.inject({
            method: 'GET',
            url: '/v1/models'
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.object).toBe('list');
        
        const modelIds = json.data.map((m: any) => m.id);
        expect(modelIds).toContain('gpt-4');
        expect(modelIds).toContain('gpt-4-alias');
        expect(modelIds).toContain('my-gpt');
        expect(modelIds).toContain('claude-3');
        expect(modelIds.length).toBe(4);
    });

    it('should handle models without additional aliases', async () => {
        const fastify = Fastify();
        await registerModelsRoute(fastify);

        const mockConfig = {
            models: {
                'simple-model': {
                    targets: []
                }
            }
        } as unknown as PlexusConfig;

        setConfigForTesting(mockConfig);

        const response = await fastify.inject({
            method: 'GET',
            url: '/v1/models'
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        const modelIds = json.data.map((m: any) => m.id);
        expect(modelIds).toEqual(['simple-model']);
    });
});
