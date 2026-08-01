import { describe, expect, it } from 'vitest';
import { formatCost, formatCostIn, getEstimatedBytesPerToken } from './format';

describe('getEstimatedBytesPerToken', () => {
  it('returns ~115 B/token for Anthropic messages streaming', () => {
    expect(getEstimatedBytesPerToken({ incomingApiType: 'messages', isStreamed: true })).toBe(115);
    expect(
      getEstimatedBytesPerToken({ outgoingApiType: 'anthropic-messages', isStreamed: true })
    ).toBe(115);
    expect(getEstimatedBytesPerToken({ incomingApiType: 'oauth', isStreamed: true })).toBe(115);
  });

  it('returns ~160 B/token for OpenAI chat & responses streaming', () => {
    expect(getEstimatedBytesPerToken({ incomingApiType: 'chat', isStreamed: true })).toBe(160);
    expect(
      getEstimatedBytesPerToken({ outgoingApiType: 'openai-completions', isStreamed: true })
    ).toBe(160);
    expect(
      getEstimatedBytesPerToken({ incomingApiType: 'openai-responses', isStreamed: true })
    ).toBe(160);
    expect(getEstimatedBytesPerToken({ incomingApiType: 'antigravity', isStreamed: true })).toBe(
      160
    );
  });

  it('returns ~140 B/token for Gemini streaming', () => {
    expect(getEstimatedBytesPerToken({ incomingApiType: 'gemini', isStreamed: true })).toBe(140);
    expect(
      getEstimatedBytesPerToken({ outgoingApiType: 'google-generative-ai', isStreamed: true })
    ).toBe(140);
  });

  it('returns ~140 B/token default for generic streaming', () => {
    expect(getEstimatedBytesPerToken({ incomingApiType: 'raw', isStreamed: true })).toBe(140);
  });

  it('returns ~4.5 B/token for non-streamed responses', () => {
    expect(getEstimatedBytesPerToken({ incomingApiType: 'chat', isStreamed: false })).toBe(4.5);
  });
});

describe('formatCostIn', () => {
  it('matches formatCost for USD at a rate of one', () => {
    for (const cost of [0, 0.00005, 0.0012, 0.01, 1234.5678]) {
      expect(formatCostIn(cost, { currency: 'USD', rate: 1 })).toBe(formatCost(cost));
    }
  });

  it('scales the USD value by the supplied rate', () => {
    expect(formatCostIn(2, { currency: 'USD', rate: 0.9 })).toBe('$1.8000');
  });

  it('uses the small-value threshold marker after conversion', () => {
    expect(formatCostIn(0.00005, { currency: 'USD', rate: 0.9 })).toBe('$<0.0001');
  });

  it('formats exactly zero as zero with the currency symbol', () => {
    expect(formatCostIn(0, { currency: 'USD', rate: 0.9 })).toBe('$0.0000');
  });

  it('applies a non-USD symbol in the locale currency position', () => {
    expect(formatCostIn(1.5, { currency: 'EUR', rate: 1, symbol: '€' })).toBe('€1.5000');
    expect(formatCostIn(1.5, { currency: 'EUR', rate: 1, symbol: 'EUR ' })).toBe('EUR 1.5000');
  });
});
