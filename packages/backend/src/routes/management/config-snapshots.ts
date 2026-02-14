import { FastifyInstance } from 'fastify';
import { eq, desc, sql, count } from 'drizzle-orm';
import { getDatabase, getSchema, getCurrentDialect } from '../../db/client';
import { logger } from '../../utils/logger';
import { getConfigPath, loadConfig } from '../../config';
import yaml from 'yaml';

interface SnapshotResponse {
  id: number;
  name: string;
  config: unknown;
  createdAt: number;
  updatedAt: number;
}

export async function registerConfigSnapshotRoutes(fastify: FastifyInstance) {
    const db = getDatabase();
    const schema = getSchema();
    const dialect = getCurrentDialect();

    // Helper to convert database row to response format
    const toSnapshotResponse = (row: any): SnapshotResponse => ({
        id: row.id,
        name: row.name,
        config: dialect === 'sqlite' ? row.config : JSON.parse(row.config),
        createdAt: row.createdAt ?? row.created_at,
        updatedAt: row.updatedAt ?? row.updated_at,
    });

    // POST /api/v1/config/save - Save current configuration with a name
    fastify.post('/api/v1/config/save', async (request, reply) => {
        try {
            const body = request.body as { name?: string; config?: unknown };

            if (!body.name || typeof body.name !== 'string') {
                return reply.code(400).send({ error: 'Name is required and must be a string' });
            }

            const name = body.name.trim();
            if (!name) {
                return reply.code(400).send({ error: 'Name cannot be empty' });
            }

            // Get current config if not provided in request
            let configData: unknown;
            if (body.config) {
                configData = body.config;
            } else {
                const configPath = getConfigPath();
                if (!configPath) {
                    return reply.code(404).send({ error: 'Configuration file path not found' });
                }
                const file = Bun.file(configPath);
                if (!(await file.exists())) {
                    return reply.code(404).send({ error: 'Configuration file not found' });
                }
                const configContent = await file.text();
                configData = yaml.parse(configContent);
            }

            const now = Date.now();

            // Check if snapshot with this name already exists
            const existingRows = await db
                .select()
                .from(schema.configSnapshots)
                .where(eq(schema.configSnapshots.name, name))
                .limit(1);

            if (existingRows.length > 0) {
                // Update existing snapshot
                await db
                    .update(schema.configSnapshots)
                    .set({
                        config: dialect === 'sqlite' ? configData : JSON.stringify(configData),
                        updatedAt: now,
                    })
                    .where(eq(schema.configSnapshots.name, name));

                logger.info(`Config snapshot '${name}' updated`);
                return reply.send({
                    success: true,
                    message: 'Configuration snapshot updated',
                    snapshot: {
                        name,
                        config: configData,
                        updatedAt: now,
                    },
                });
            }

            // Create new snapshot
            await db
                .insert(schema.configSnapshots)
                .values({
                    name,
                    config: dialect === 'sqlite' ? configData : JSON.stringify(configData),
                    createdAt: now,
                    updatedAt: now,
                });

            logger.info(`Config snapshot '${name}' created`);
            return reply.code(201).send({
                success: true,
                message: 'Configuration snapshot created',
                snapshot: {
                    name,
                    config: configData,
                    createdAt: now,
                    updatedAt: now,
                },
            });
        } catch (e: any) {
            logger.error('Failed to save config snapshot', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // GET /api/v1/config/snapshots - List all saved configurations
    fastify.get('/api/v1/config/snapshots', async (request, reply) => {
        try {
            const query = request.query as { limit?: string; offset?: string };
            const limit = parseInt(query.limit || '50');
            const offset = parseInt(query.offset || '0');

            const rows = await db
                .select({
                    id: schema.configSnapshots.id,
                    name: schema.configSnapshots.name,
                    config: schema.configSnapshots.config,
                    createdAt: schema.configSnapshots.createdAt,
                    updatedAt: schema.configSnapshots.updatedAt,
                })
                .from(schema.configSnapshots)
                .orderBy(desc(schema.configSnapshots.createdAt))
                .limit(limit)
                .offset(offset);

            const countResult = await db
                .select({ count: count() })
                .from(schema.configSnapshots);
            const total = countResult[0]?.count ?? 0;

            const snapshots = rows.map(toSnapshotResponse);

            return reply.send({
                data: snapshots,
                total,
                limit,
                offset,
            });
        } catch (e: any) {
            logger.error('Failed to list config snapshots', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // POST /api/v1/config/restore/:name - Restore a saved configuration
    fastify.post('/api/v1/config/restore/:name', async (request, reply) => {
        try {
            const params = request.params as { name: string };
            const name = params.name;

            // Get the snapshot
            const rows = await db
                .select()
                .from(schema.configSnapshots)
                .where(eq(schema.configSnapshots.name, name))
                .limit(1);

            if (rows.length === 0) {
                return reply.code(404).send({ error: `Snapshot '${name}' not found` });
            }

            const snapshot = toSnapshotResponse(rows[0]);

            // Get config path
            const configPath = getConfigPath();
            if (!configPath) {
                return reply.code(500).send({ error: 'Configuration path not determined' });
            }

            // Write config to file
            const configYaml = yaml.stringify(snapshot.config);
            await Bun.write(configPath, configYaml);

            // Reload config
            await loadConfig(configPath);

            logger.info(`Config restored from snapshot '${name}' to ${configPath}`);
            return reply.send({
                success: true,
                message: 'Configuration restored successfully',
                snapshot: {
                    name: snapshot.name,
                    restoredAt: Date.now(),
                },
            });
        } catch (e: any) {
            logger.error('Failed to restore config snapshot', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // DELETE /api/v1/config/snapshots/:name - Delete a saved configuration
    fastify.delete('/api/v1/config/snapshots/:name', async (request, reply) => {
        try {
            const params = request.params as { name: string };
            const name = params.name;

            // Check if snapshot exists
            const existingRows = await db
                .select({ id: schema.configSnapshots.id })
                .from(schema.configSnapshots)
                .where(eq(schema.configSnapshots.name, name))
                .limit(1);

            if (existingRows.length === 0) {
                return reply.code(404).send({ error: `Snapshot '${name}' not found` });
            }

            // Delete the snapshot
            await db
                .delete(schema.configSnapshots)
                .where(eq(schema.configSnapshots.name, name));

            logger.info(`Config snapshot '${name}' deleted`);
            return reply.send({
                success: true,
                message: `Snapshot '${name}' deleted successfully`,
            });
        } catch (e: any) {
            logger.error('Failed to delete config snapshot', e);
            return reply.code(500).send({ error: e.message });
        }
    });
}

