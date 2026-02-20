import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import yaml from 'yaml';
import { logger } from '../../utils/logger';
import { getConfigPath, validateConfig, loadConfig, VALID_QUOTA_CHECKER_TYPES } from '../../config';

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

    fastify.delete('/v0/management/providers/:providerId', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(500).send({ error: 'Configuration path not determined' });
        }

        const params = request.params as { providerId: string };
        const providerId = params.providerId;
        const query = request.query as { cascade?: string };
        const cascade = query.cascade === 'true';

        try {
            const file = Bun.file(configPath);
            if (!(await file.exists())) {
                return reply.code(404).send({ error: 'Configuration file not found' });
            }

            const configContent = await file.text();
            const parsed = (yaml.parse(configContent) as any) || {};
            const providers = parsed.providers || {};

            if (!providers[providerId]) {
                return reply.code(404).send({ error: `Provider '${providerId}' not found` });
            }

            delete providers[providerId];
            parsed.providers = providers;

            let removedTargets = 0;
            const affectedAliases: string[] = [];

            if (cascade) {
                const models = parsed.models || {};
                for (const [aliasId, alias] of Object.entries(models)) {
                    const aliasObj = alias as any;
                    if (aliasObj.targets && Array.isArray(aliasObj.targets)) {
                        const originalLength = aliasObj.targets.length;
                        aliasObj.targets = aliasObj.targets.filter(
                            (target: any) => target.provider !== providerId
                        );
                        const targetsRemoved = originalLength - aliasObj.targets.length;
                        if (targetsRemoved > 0) {
                            removedTargets += targetsRemoved;
                            affectedAliases.push(aliasId);
                        }
                    }
                }
                parsed.models = models;
            }

            const updatedConfig = yaml.stringify(parsed);
            validateConfig(updatedConfig);

            await Bun.write(configPath, updatedConfig);
            logger.info(`Provider '${providerId}' deleted via API at ${configPath}${cascade ? ' (cascade)' : ''}`);
            await loadConfig(configPath);

            return reply.send({
                success: true,
                provider: providerId,
                removedTargets: cascade ? removedTargets : undefined,
                affectedAliases: cascade ? affectedAliases : undefined,
            });
        } catch (e: any) {
            logger.error(`Failed to delete provider '${providerId}'`, e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // MCP Server Management
    fastify.get('/v0/management/mcp-servers', async (_request, reply) => {
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
            const mcpServers = parsed.mcp_servers || {};

            return reply.send(mcpServers);
        } catch (e: any) {
            logger.error('Failed to get MCP servers', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.post('/v0/management/mcp-servers/:serverName', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(500).send({ error: 'Configuration path not determined' });
        }

        const params = request.params as { serverName: string };
        const serverName = params.serverName;
        const body = request.body as { upstream_url?: string; enabled?: boolean; headers?: Record<string, string> };

        if (!body || !body.upstream_url) {
            return reply.code(400).send({ error: 'upstream_url is required' });
        }

        // Validate server name (slug pattern)
        if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(serverName)) {
            return reply.code(400).send({ error: 'Invalid server name. Must be a slug (lowercase letters, numbers, hyphens, underscores, 2-63 characters)' });
        }

        try {
            const file = Bun.file(configPath);
            if (!(await file.exists())) {
                return reply.code(404).send({ error: 'Configuration file not found' });
            }

            const configContent = await file.text();
            const parsed = (yaml.parse(configContent) as any) || {};
            
            if (!parsed.mcp_servers) {
                parsed.mcp_servers = {};
            }

            parsed.mcp_servers[serverName] = {
                upstream_url: body.upstream_url,
                enabled: body.enabled !== false,
                headers: body.headers || {}
            };

            const updatedConfig = yaml.stringify(parsed);
            validateConfig(updatedConfig);

            await Bun.write(configPath, updatedConfig);
            logger.info(`MCP server '${serverName}' saved via API at ${configPath}`);
            await loadConfig(configPath);

            return reply.send({ success: true, name: serverName, ...parsed.mcp_servers[serverName] });
        } catch (e: any) {
            logger.error(`Failed to save MCP server '${serverName}'`, e);
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/mcp-servers/:serverName', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(500).send({ error: 'Configuration path not determined' });
        }

        const params = request.params as { serverName: string };
        const serverName = params.serverName;

        try {
            const file = Bun.file(configPath);
            if (!(await file.exists())) {
                return reply.code(404).send({ error: 'Configuration file not found' });
            }

            const configContent = await file.text();
            const parsed = (yaml.parse(configContent) as any) || {};
            const mcpServers = parsed.mcp_servers || {};

            if (!mcpServers[serverName]) {
                return reply.code(404).send({ error: `MCP server '${serverName}' not found` });
            }

            delete mcpServers[serverName];
            parsed.mcp_servers = mcpServers;

            const updatedConfig = yaml.stringify(parsed);
            validateConfig(updatedConfig);

            await Bun.write(configPath, updatedConfig);
            logger.info(`MCP server '${serverName}' deleted via API at ${configPath}`);
            await loadConfig(configPath);

            return reply.send({ success: true });
        } catch (e: any) {
            logger.error(`Failed to delete MCP server '${serverName}'`, e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // Quota checker types endpoint - single source of truth
    fastify.get('/v0/management/quota-checker-types', async (_request, reply) => {
        return reply.send({
            types: VALID_QUOTA_CHECKER_TYPES,
            count: VALID_QUOTA_CHECKER_TYPES.length
        });
    });

    // Support YAML and Plain Text payloads for management API
    fastify.addContentTypeParser(['text/plain', 'application/x-yaml', 'text/yaml'], { parseAs: 'string' }, (req, body, done) => {
        done(null, body);
    });
}
