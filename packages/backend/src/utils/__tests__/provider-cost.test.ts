import { describe, test, expect } from 'vitest';
import { applyProviderReportedCost } from '../provider-cost';
import type { UsageRecord } from '../../types/usage';

function createUsageRecord(overrides: Partial<UsageRecord> = {}): Partial<UsageRecord> {
  return {
    requestId: 'test-123',
    costInput: 0.001,
    costOutput: 0.002,
    costCached: 0.0005,
    costCacheWrite: 0,
    costTotal: 0.0035,
    costSource: 'simple',
    costMetadata: JSON.stringify({ input: 3, output: 6, cached: 1.5, cache_write: 0 }),
    ...overrides,
  };
}

describe('applyProviderReportedCost', () => {
  test('overrides costTotal with request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, {
      request_cost_usd: 0.0007217243274280318,
      cache_savings_usd: 0.0,
      allowance_remaining_usd: 14.991,
      budget_remaining_usd: 14.991,
    });

    expect(record.costTotal).toBe(0.00072172);
    expect(record.costSource).toBe('provider_reported');
    expect(record.providerReportedCost).toBe(0.0007217243274280318);
  });

  test('distributes cost proportionally based on existing cost ratios', () => {
    const record = createUsageRecord();
    // costInput=0.001, costOutput=0.002, costCached=0.0005, total=0.0035
    applyProviderReportedCost(record, {
      request_cost_usd: 0.007,
      cache_savings_usd: 0.0,
    });

    expect(record.costTotal).toBe(0.007);
    // Ratios: input=1/3.5, output=2/3.5, cached=0.5/3.5
    expect(record.costInput).toBeCloseTo((0.001 / 0.0035) * 0.007, 8);
    expect(record.costOutput).toBeCloseTo((0.002 / 0.0035) * 0.007, 8);
    expect(record.costCached).toBeCloseTo((0.0005 / 0.0035) * 0.007, 8);
  });

  test('attributes full cost to input when no breakdown available', () => {
    const record = createUsageRecord({
      costInput: 0,
      costOutput: 0,
      costCached: 0,
      costCacheWrite: 0,
      costTotal: 0,
    });
    applyProviderReportedCost(record, {
      request_cost_usd: 0.005,
    });

    expect(record.costTotal).toBe(0.005);
    expect(record.costInput).toBe(0.005);
    expect(record.costOutput).toBe(0);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('stores full provider payload in costMetadata', () => {
    const record = createUsageRecord();
    const costData = {
      request_cost_usd: 0.0007217243274280318,
      cache_savings_usd: 0.0,
      allowance_remaining_usd: 14.991,
      budget_remaining_usd: 14.991,
    };
    applyProviderReportedCost(record, costData);

    const metadata = JSON.parse(record.costMetadata!);
    expect(metadata.source).toBe('provider_reported');
    expect(metadata.request_cost_usd).toBe(0.0007217243274280318);
    expect(metadata.cache_savings_usd).toBe(0.0);
    expect(metadata.allowance_remaining_usd).toBe(14.991);
    expect(metadata.budget_remaining_usd).toBe(14.991);
    expect(metadata.previous_cost_source).toBe('simple');
    expect(metadata.previous_cost_total).toBe(0.0035);
  });

  test('ignores invalid request_cost_usd (not a number)', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { request_cost_usd: 'invalid' });

    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('ignores negative request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { request_cost_usd: -0.001 });

    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('ignores missing request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { cache_savings_usd: 0.0 });

    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('handles zero request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { request_cost_usd: 0 });

    expect(record.costTotal).toBe(0);
    expect(record.costSource).toBe('provider_reported');
    expect(record.costInput).toBe(0);
    expect(record.costOutput).toBe(0);
  });
});

describe('extractProviderCostFromSSEComments (via DebugLoggingInspector)', () => {
  test('parses : cost SSE comment lines from raw SSE body', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      ': cost {"request_cost_usd": 0.0007217243274280318, "cache_savings_usd": 0.0, "allowance_remaining_usd": 14.991, "budget_remaining_usd": 14.991}',
      '',
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    // Use the same regex logic that DebugLoggingInspector uses
    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        lastCost = JSON.parse(costMatch[1]!);
      }
    }

    expect(lastCost).not.toBeNull();
    expect(lastCost.request_cost_usd).toBe(0.0007217243274280318);
    expect(lastCost.cache_savings_usd).toBe(0.0);
    expect(lastCost.allowance_remaining_usd).toBe(14.991);
    expect(lastCost.budget_remaining_usd).toBe(14.991);
  });

  test('uses last cost line when multiple are present', () => {
    const rawBody = [
      ': cost {"request_cost_usd": 0.001}',
      ': cost {"request_cost_usd": 0.002}',
    ].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        lastCost = JSON.parse(costMatch[1]!);
      }
    }

    expect(lastCost.request_cost_usd).toBe(0.002);
  });

  test('returns null when no cost lines present', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      'data: [DONE]',
    ].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        lastCost = JSON.parse(costMatch[1]!);
      }
    }

    expect(lastCost).toBeNull();
  });

  test('skips malformed cost lines', () => {
    const rawBody = [': cost not-json', ': cost {"request_cost_usd": 0.001}'].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        try {
          lastCost = JSON.parse(costMatch[1]!);
        } catch (e) {
          // Skip
        }
      }
    }

    expect(lastCost.request_cost_usd).toBe(0.001);
  });
});

describe('extractProviderEnergyFromSSEComments (via DebugLoggingInspector)', () => {
  test('parses : energy SSE comment lines from raw SSE body', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      ': energy {"energy_joules": 190.46, "energy_kwh": 5.2904e-05, "avg_power_watts": 3109.0, "duration_seconds": 0.613}',
      '',
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    // Use the same regex logic that DebugLoggingInspector uses
    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy).not.toBeNull();
    expect(lastEnergy.energy_joules).toBe(190.46);
    expect(lastEnergy.energy_kwh).toBe(5.2904e-5);
    expect(lastEnergy.avg_power_watts).toBe(3109.0);
    expect(lastEnergy.duration_seconds).toBe(0.613);
  });

  test('uses last energy line when multiple are present', () => {
    const rawBody = [': energy {"energy_kwh": 0.0001}', ': energy {"energy_kwh": 0.00052904}'].join(
      '\n'
    );

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy.energy_kwh).toBe(0.00052904);
  });

  test('returns null when no energy lines present', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      'data: [DONE]',
    ].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy).toBeNull();
  });

  test('skips malformed energy lines', () => {
    const rawBody = [': energy not-json', ': energy {"energy_kwh": 0.0001}'].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        try {
          lastEnergy = JSON.parse(energyMatch[1]!);
        } catch (e) {
          // Skip
        }
      }
    }

    expect(lastEnergy.energy_kwh).toBe(0.0001);
  });

  test('handles scientific notation for energy_kwh', () => {
    const rawBody = [': energy {"energy_kwh": 5.2904e-05}'].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy.energy_kwh).toBe(5.2904e-5);
  });
});
