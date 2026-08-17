import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerInferenceRoutes } from '../index';
import { Dispatcher } from '../../../services/dispatch/dispatcher';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import { DebugManager } from '../../../services/observability/debug-manager';
import { SelectorFactory } from '../../../services/routing/selectors/factory';

describe('Speech Route Debug Logging', () => {
  let fastify: FastifyInstance;
  let mockUsageStorage: UsageStorageService;
  let mockDispatcher: Dispatcher;
  let debugManager: DebugManager;
  let savedDebugLogs: any[] = [];
  let wasDebugEnabled: boolean = false;

  beforeAll(async () => {
    debugManager = DebugManager.getInstance();
    wasDebugEnabled = debugManager.isEnabled();

    fastify = Fastify();

    mockDispatcher = {
      dispatchSpeech: vi.fn(async () => ({
        audio: Buffer.from([0x01, 0x02, 0x03, 0x04]),
        plexus: {
          provider: 'openai-s',
          model: 'gpt-4o-mini-tts',
          apiType: 'speech',
          canonicalModel: 'gpt-4o-mini-tts',
          pricing: { source: 'simple', input: 0, output: 0 },
        },
      })),
    } as unknown as Dispatcher;

    savedDebugLogs = [];
    mockUsageStorage = {
      saveRequest: vi.fn(),
      saveError: vi.fn(),
      updatePerformanceMetrics: vi.fn(),
      emitStartedAsync: vi.fn(),
      emitUpdatedAsync: vi.fn(),
      saveDebugLog: vi.fn((log: any) => {
        savedDebugLogs.push(log);
      }),
    } as unknown as UsageStorageService;

    debugManager.setStorage(mockUsageStorage);
    debugManager.setEnabled(true);
    SelectorFactory.setUsageStorage(mockUsageStorage);

    setConfigForTesting({
      providers: {
        'openai-s': {
          api_key: 'sk-test',
          api_base_url: 'https://api.openai.com/v1',
          enabled: true,
          disable_cooldown: false,
          stall_cooldown: false,
          allow_100_percent_utilization: false,
          estimateTokens: false,
          useClaudeMasking: false,
          models: {
            'gpt-4o-mini-tts': {
              type: 'speech',
              pricing: { source: 'simple', input: 0, output: 0 },
            },
          },
        },
      },
      models: {
        'gpt-4o-mini-tts': {
          type: 'speech',
          priority: 'selector',
          sticky_session: false,
          targets: [{ provider: 'openai-s', model: 'gpt-4o-mini-tts' }],
        },
      },
      keys: {
        'test-key-1': { secret: 'sk-valid-key', comment: 'Test Key' },
      },
      failover: {
        enabled: false,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      },
      quotas: [],
    });

    await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
    await fastify.ready();
  });

  afterAll(() => {
    debugManager.setEnabled(wasDebugEnabled);
  });

  it('captures the incoming request text (input) for TTS in the debug log', async () => {
    const testInput = 'Verify that this exact text is captured in the debug log!';

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/audio/speech',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'gpt-4o-mini-tts',
        input: testInput,
        voice: 'alloy',
        response_format: 'mp3',
      },
    });

    expect(response.statusCode).toBe(200);

    // Verify debug log was saved
    expect(savedDebugLogs.length).toBeGreaterThan(0);

    const debugLog = savedDebugLogs[savedDebugLogs.length - 1];

    // Check rawRequest (from route handler startLog)
    expect(debugLog.rawRequest).toBeDefined();
    expect(debugLog.rawRequest.model).toBe('gpt-4o-mini-tts');
    expect(debugLog.rawRequest.voice).toBe('alloy');
    expect(debugLog.rawRequest.inputLength).toBe(testInput.length);

    // CRITICAL: Ensure the input text itself is captured
    expect(debugLog.rawRequest.input).toBe(testInput);
  });
});
