import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { BackupService } from '../../services/backup-service';

export async function registerBackupRoutes(fastify: FastifyInstance) {
  const backupService = new BackupService();

  // ─── GET /v0/management/backup ──────────────────────────────────

  /**
   * Export a database backup.
   *
   * Query params:
   *   - full: if "true", returns a .tar.gz archive with config + operational data
   *           otherwise returns config-only JSON
   */
  fastify.get('/v0/management/backup', async (request, reply) => {
    const query = request.query as { full?: string };
    const isFull = query.full === 'true';

    try {
      if (isFull) {
        logger.info('[Backup] Starting full backup export');
        const archive = await backupService.exportFullBackup();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return reply
          .header('Content-Type', 'application/gzip')
          .header('Content-Disposition', `attachment; filename="plexus-backup-${timestamp}.tar.gz"`)
          .send(archive);
      } else {
        logger.info('[Backup] Starting config-only backup export');
        const envelope = await backupService.exportConfigBackup();
        return reply.send(envelope);
      }
    } catch (e: any) {
      logger.error('[Backup] Export failed:', e);
      return reply.code(500).send({ error: e.message || 'Backup export failed' });
    }
  });

  // ─── POST /v0/management/restore ─────────────────────────────────

  /**
   * Restore database from a backup.
   *
   * Accepts either:
   *   - application/json: a config-only backup envelope
   *   - application/gzip or application/octet-stream: a .tar.gz full backup archive
   *
   * This is a destructive operation — all existing data is replaced.
   */
  fastify.post('/v0/management/restore', async (request, reply) => {
    try {
      const contentType = request.headers['content-type'] || '';
      let result;

      if (
        contentType.includes('application/gzip') ||
        contentType.includes('application/octet-stream') ||
        contentType.includes('application/x-gzip')
      ) {
        // Binary archive
        if (!Buffer.isBuffer(request.body)) {
          return reply.code(400).send({ error: 'Expected binary body for archive restore' });
        }
        logger.info('[Backup] Starting full archive restore');
        result = await backupService.restoreFullBackup(request.body);
      } else {
        // JSON config-only envelope
        const body = request.body as Record<string, unknown>;
        if (!body || !body.plexus_backup) {
          return reply.code(400).send({ error: 'Invalid backup: missing plexus_backup field' });
        }
        logger.info('[Backup] Starting config-only restore');
        result = await backupService.restoreFullBackup(body);
      }

      // After restore, restart the server so all services pick up the new data.
      // We send the response first, then close/exit after a short delay —
      // the process manager (bun --watch, Docker, systemd) will respawn us.
      return reply.send(result);
    } catch (e: any) {
      logger.error('[Backup] Restore failed:', e);
      return reply.code(500).send({ error: e.message || 'Backup restore failed' });
    }
  });

  // Allow binary body parsing for .tar.gz uploads
  fastify.addContentTypeParser(
    ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );
}
