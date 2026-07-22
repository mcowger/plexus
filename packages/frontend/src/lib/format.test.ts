import { describe, expect, it } from 'vitest';
import { getEstimatedBytesPerToken } from './format';

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
