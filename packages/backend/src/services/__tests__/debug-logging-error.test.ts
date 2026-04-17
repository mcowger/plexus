import { describe, expect, test, beforeEach, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Dispatcher } from '../dispatcher';
import { DebugManager } from '../debug-manager';
import { setConfigForTesting } from '../../config';
import { UnifiedChatRequest } from '../../types/unified';

describe('Dispatcher Error Logging', () => {
  let addRawResponseSpy: any;

  beforeEach(() => {
    // Reset DebugManager singleton state
    const debugManager = DebugManager.getInstance();
    debugManager.setEnabled(true);
    // @ts-ignore - access private for testing
    debugManager.pendingLogs.clear();

    // Spy on DebugManager.addRawResponse
    addRawResponseSpy = registerSpy(debugManager, 'addRawResponse');
  });

  test('Captures error response in debug log when upstream fails', async () => {
    // 1. Setup mock config
    const mockConfig = {
      providers: {
        openai: {
          type: 'chat',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'test-key',
          models: {
            'gpt-4o': {
              pricing: { source: 'simple', input: 0, output: 0 },
            },
          },
        },
      },
      models: {
        'gpt-4o': {
          targets: [{ provider: 'openai', model: 'gpt-4o' }],
        },
      },
    };
    setConfigForTesting(mockConfig as any);

    // 2. Mock fetch to return a 400 error
    const errorBody = JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'invalid params' },
    });

    global.fetch = vi.fn(async () => {
      return new Response(errorBody, {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const dispatcher = new Dispatcher();
    const requestId = 'test-request-id';
    const request: UnifiedChatRequest = {
      requestId,
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      incomingApiType: 'chat',
    };

    // 3. Dispatch and expect error
    try {
      await dispatcher.dispatch(request);
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      // 4. Verify addRawResponse was called with the error body
      expect(addRawResponseSpy).toHaveBeenCalledWith(requestId, errorBody);
    }
  });
});
