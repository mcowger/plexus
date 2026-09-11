import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { BackupService } from '../../../services/configuration/backup-service';
import { ModelMetadataManager } from '../../../services/models/model-metadata-manager';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - operations', () => {
  const fixture = createPlexusMcpTestFixture();

  beforeAll(async () => {
    await fixture.start();
  });

  beforeEach(() => {
    fixture.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('implements plexus_operations cooldown operations', async () => {
    const listResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'list_cooldowns' },
        },
      },
      fixture.adminHeaders()
    );
    const listBody = fixture.parseJsonRpcResponse(listResponse);
    expect(listBody.result.structuredContent.ok).toBe(true);

    const clearResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_operations',
          arguments: {
            operation: 'clear_cooldowns',
            destructive: 'acknowledged',
            query: { provider: 'openrouter', model: 'openai/gpt-5' },
          },
        },
      },
      fixture.adminHeaders()
    );
    const clearBody = fixture.parseJsonRpcResponse(clearResponse);
    expect(clearBody.result.structuredContent.data.success).toBe(true);
  });

  test('implements plexus_operations backup and restart response', async () => {
    registerSpy(BackupService.prototype, 'exportConfigBackup').mockResolvedValue({
      plexus_backup: true,
      version: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      dialect: 'sqlite',
      data: {
        providers: {},
        models: {},
        keys: {},
        user_quotas: {},
        mcp_servers: {},
        settings: {},
        oauth_credentials: [],
      },
    });

    const backupResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'backup' },
        },
      },
      fixture.adminHeaders()
    );
    const backupBody = fixture.parseJsonRpcResponse(backupResponse);
    expect(backupBody.result.structuredContent.ok).toBe(true);
    expect(backupBody.result.structuredContent.data.full).toBe(false);

    const restartResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'restart', destructive: 'acknowledged' },
        },
      },
      fixture.adminHeaders()
    );
    const restartBody = fixture.parseJsonRpcResponse(restartResponse);
    expect(restartBody.result.structuredContent.ok).toBe(true);
    expect(restartBody.result.structuredContent.data.success).toBe(true);
    expect(restartBody.result.structuredContent.data.message).toContain('restarting');
  });

  test('implements plexus_operations refresh_metadata response', async () => {
    registerSpy(ModelMetadataManager.getInstance(), 'refreshAll').mockResolvedValue({
      success: true,
      message: 'Model metadata refresh completed successfully',
      trigger: 'manual',
      refreshedAt: '2026-06-10T12:00:00.000Z',
      durationMs: 25,
      intervalMinutes: 60,
      hadErrors: false,
      sources: {
        openrouter: { source: 'openrouter', initialized: true, count: 10 },
        modelsDev: { source: 'models.dev', initialized: true, count: 20 },
        catwalk: { source: 'catwalk', initialized: true, count: 30 },
      },
    });

    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 3,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'refresh_metadata' },
        },
      },
      fixture.adminHeaders()
    );

    const body = fixture.parseJsonRpcResponse(response);
    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.message).toContain('refresh completed');
    expect(body.result.structuredContent.data.sources.modelsDev.count).toBe(20);
  });
});
