import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import yaml from 'yaml';
import { logger } from '../../utils/logger';
import { getConfigPath, validateConfig, loadConfig } from '../../config';

export async function registerConfigRoutes(fastify: FastifyInstance) {
    fastify.get('/v0/management/config', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(404).send({ error: "Configuration file path not found" });
        }
        const file = Bun.file(configPath);
        if (!(await file.exists())) {
            return reply.code(404).send({ error: "Configuration file not found" });
        }
        const configContent = await file.text();
        reply.header('Content-Type', 'application/x-yaml');
        return reply.send(configContent);
    });

    fastify.post('/v0/management/config', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
             return reply.code(500).send({ error: "Configuration path not determined" });
        }

        try {
            const body = request.body as string; 
            let configStr = body;
            if (typeof body !== 'string') {
                 configStr = JSON.stringify(body);
            }

            try {
                validateConfig(configStr);
            } catch (e) {
                if (e instanceof z.ZodError) {
                    return reply.code(400).send({ error: "Validation failed", details: e.errors });
                }
                 return reply.code(400).send({ error: "Invalid YAML or Schema", details: String(e) });
            }

            await Bun.write(configPath, configStr);
            logger.info(`Configuration updated via API at ${configPath}`);
            await loadConfig(configPath);
            
            return reply.code(200).header('Content-Type', 'application/x-yaml').send(configStr);
        } catch (e: any) {
            logger.error("Failed to update config", e);
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/models/:aliasId', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(500).send({ error: 'Configuration path not determined' });
        }

        const params = request.params as { aliasId: string };
        const aliasId = params.aliasId;

        try {
            const file = Bun.file(configPath);
            if (!(await file.exists())) {
                return reply.code(404).send({ error: 'Configuration file not found' });
            }

            const configContent = await file.text();
            const parsed = (yaml.parse(configContent) as any) || {};
            const models = parsed.models || {};

            if (!models[aliasId]) {
                return reply.code(404).send({ error: `Model alias '${aliasId}' not found` });
            }

            delete models[aliasId];
            parsed.models = models;

            const updatedConfig = yaml.stringify(parsed);
            validateConfig(updatedConfig);

            await Bun.write(configPath, updatedConfig);
            logger.info(`Model alias '${aliasId}' deleted via API at ${configPath}`);
            await loadConfig(configPath);

            return reply.send({ success: true });
        } catch (e: any) {
            logger.error(`Failed to delete model alias '${aliasId}'`, e);
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/models', async (_request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(500).send({ error: 'Configuration path not determined' });
        }

        try {
            const file = Bun.file(configPath);
            if (!(await file.exists())) {
                return reply.code(404).send({ error: 'Configuration file not found' });
            }

            const configContent = await file.text();
            const parsed = (yaml.parse(configContent) as any) || {};
            const deletedCount = Object.keys(parsed.models || {}).length;

            parsed.models = {};

            const updatedConfig = yaml.stringify(parsed);
            validateConfig(updatedConfig);

            await Bun.write(configPath, updatedConfig);
            logger.info(`Deleted all model aliases (${deletedCount}) via API at ${configPath}`);
            await loadConfig(configPath);

            return reply.send({ success: true, deletedCount });
        } catch (e: any) {
            logger.error('Failed to delete all model aliases', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // Support YAML and Plain Text payloads for management API
    fastify.addContentTypeParser(['text/plain', 'application/x-yaml', 'text/yaml'], { parseAs: 'string' }, (req, body, done) => {
        done(null, body);
    });
}
