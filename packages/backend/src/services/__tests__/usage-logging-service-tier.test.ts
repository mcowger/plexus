import { afterEach, beforeEach, describe, expect, it, mock, test } from 'bun:test';
import { PassThrough } from 'stream';

import { registerSpy } from '../../../test/test-utils';
import type { UsageRecord } from '../../types/usage';
import { UsageInspector } from '../inspectors/usage-logging';
import { DebugManager } from '../observability/debug-manager';

/**
 * The inspector is the point where a streaming response's native body/stream
 * bytes (reconstructed by the debug tap) are available, so it is responsible
 * for overriding a header-derived actual tier with the body-reported one.
 */
describe('UsageInspector service-tier capture', () => {
  let mockStorage: any;
  const mockPricing = { inputCostPerToken: 0, outputCostPerToken: 0 };

  beforeEach(() => {
    mockStorage = {
      saveRequest: mock(() => Promise.resolve()),
      updatePerformanceMetrics: mock(() => Promise.resolve()),
    };
    const dm = DebugManager.getInstance();
    dm.resetForTesting();
    dm.setEnabled(true);
  });

  afterEach(() => {
    DebugManager.getInstance().setEnabled(false);
  });

  const runInspector = async (
    requestId: string,
    apiType: string,
    snapshot: any,
    seedRecord: Partial<UsageRecord> = {}
  ): Promise<UsageRecord | null> => {
    const inspector = new UsageInspector(
      requestId,
      mockStorage,
      { requestId, ...seedRecord } as Partial<UsageRecord>,
      mockPricing,
      undefined,
      Date.now(),
      false,
      apiType,
      apiType
    );

    const dm = DebugManager.getInstance();
    dm.startLog(requestId, {});
    dm.addReconstructedRawResponse(requestId, snapshot);

    let capturedRecord: UsageRecord | null = null;
    registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
      capturedRecord = record;
      return Promise.resolve();
    });

    const mockStream = new PassThrough();
    mockStream.pipe(inspector);
    mockStream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    return capturedRecord;
  };

  it('captures an OpenAI chat response service_tier', async () => {
    const record = await runInspector('st-chat', 'chat', {
      service_tier: 'flex',
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(record?.serviceTier).toBe('flex');
    expect(record?.serviceTierRaw).toBe('flex');
  });

  it('captures Anthropic fast mode via usage.speed over usage.service_tier', async () => {
    const record = await runInspector('st-anthropic', 'messages', {
      usage: {
        speed: 'fast',
        service_tier: 'standard',
        input_tokens: 1,
        output_tokens: 1,
      },
    });
    expect(record?.serviceTier).toBe('priority');
    expect(record?.serviceTierRaw).toBe('fast');
  });

  it('keeps the Gemini header tier over a competing reconstructed body', async () => {
    const record = await runInspector(
      'st-gemini-header',
      'gemini',
      { service_tier: 'flex', usageMetadata: { promptTokenCount: 1 } },
      { serviceTier: 'priority', serviceTierRaw: 'priority' }
    );
    expect(record?.serviceTier).toBe('priority');
    expect(record?.serviceTierRaw).toBe('priority');
  });

  it('does not record a Responses created echo on a cancelled stream', async () => {
    const requestId = 'st-responses-destroy';
    const inspector = new UsageInspector(
      requestId,
      mockStorage,
      { requestId } as Partial<UsageRecord>,
      mockPricing,
      undefined,
      Date.now(),
      false,
      'responses',
      'responses'
    );

    const dm = DebugManager.getInstance();
    dm.startLog(requestId, {});
    dm.addReconstructedRawResponse(requestId, {
      type: 'response.created',
      response: { status: 'in_progress', service_tier: 'auto' },
    });

    const captured: { record: UsageRecord | null } = { record: null };
    registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
      captured.record = record;
      return Promise.resolve();
    });

    await new Promise<void>((resolve) =>
      inspector._destroy(new Error('client cancelled'), () => resolve())
    );

    expect(captured.record?.responseStatus).toBe('cancelled');
    expect(captured.record?.serviceTier ?? null).toBeNull();
    expect(captured.record?.serviceTierRaw ?? null).toBeNull();
  });

  it('does not record a Responses in_progress echo as the actual tier', async () => {
    const record = await runInspector('st-responses-cancelled', 'responses', {
      status: 'in_progress',
      service_tier: 'auto',
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect(record?.serviceTier ?? null).toBeNull();
    expect(record?.serviceTierRaw ?? null).toBeNull();
  });

  it('records a Responses terminal actual tier', async () => {
    const record = await runInspector('st-responses-completed', 'responses', {
      status: 'completed',
      service_tier: 'priority',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(record?.serviceTier).toBe('priority');
    expect(record?.serviceTierRaw).toBe('priority');
  });

  it('never infers the actual tier from a requested tier', async () => {
    const record = await runInspector(
      'st-no-actual',
      'chat',
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
      { requestedServiceTier: 'priority', requestedServiceTierRaw: 'fast' }
    );
    expect(record?.requestedServiceTier).toBe('priority');
    expect(record?.requestedServiceTierRaw).toBe('fast');
    expect(record?.serviceTier ?? null).toBeNull();
    expect(record?.serviceTierRaw ?? null).toBeNull();
  });
});
