import { describe, test, expect } from 'bun:test';
import {
  extractLastUserMessage,
  estimateTokens,
  detectHeartbeat,
  detectForcedTier,
  detectTokenOverflow,
  runPhase1,
} from '../../src/classifier/phase1';
import { Tier } from '../../src/classifier/types';
import { DEFAULT_CLASSIFIER_CONFIG } from '../../src/classifier/config';

describe('extractLastUserMessage', () => {
  test('returns last user message content as string', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi!' },
      { role: 'user' as const, content: 'What is the capital of France?' },
    ];
    expect(extractLastUserMessage(messages)).toBe('What is the capital of France?');
  });

  test('returns empty string when no user message exists', () => {
    const messages = [{ role: 'system' as const, content: 'You are helpful.' }];
    expect(extractLastUserMessage(messages)).toBe('');
  });

  test('concatenates text parts from multimodal content', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'image_url', url: 'http://example.com/img.png' },
          { type: 'text', text: 'World' },
        ],
      },
    ];
    expect(extractLastUserMessage(messages)).toBe('Hello World');
  });
});

describe('estimateTokens', () => {
  test('returns overhead tokens for empty content', () => {
    const messages = [{ role: 'user' as const, content: '' }];
    // 4 tokens overhead + 0 content tokens
    expect(estimateTokens(messages)).toBe(4);
  });

  test('estimates tokens using 4-char heuristic', () => {
    const messages = [{ role: 'user' as const, content: 'What is the capital of France?' }];
    // 4 overhead + ceil(30/4) = 4 + 8 = 12
    const result = estimateTokens(messages);
    expect(result).toBeGreaterThan(4);
  });

  test('counts tool_calls in estimation', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
      },
    ];
    const result = estimateTokens(messages);
    // 4 overhead + ceil(11/4) + ceil(16/4) = 4 + 3 + 4 = 11
    expect(result).toBeGreaterThan(4);
  });
});

describe('detectHeartbeat', () => {
  test('matches "ping" pattern', () => {
    expect(detectHeartbeat('ping', [{ role: 'user', content: 'ping' }], false)).toBe(true);
  });

  test('matches "hello" greeting pattern', () => {
    expect(detectHeartbeat('hello', [{ role: 'user', content: 'hello' }], false)).toBe(true);
  });

  test('matches "thanks" pattern', () => {
    expect(detectHeartbeat('thanks', [{ role: 'user', content: 'thanks' }], false)).toBe(true);
  });

  test('matches "ok" acknowledgment pattern', () => {
    expect(detectHeartbeat('ok', [{ role: 'user', content: 'ok' }], false)).toBe(true);
  });

  test('matches "bye" pattern', () => {
    expect(detectHeartbeat('bye', [{ role: 'user', content: 'bye' }], false)).toBe(true);
  });

  test('matches empty string pattern', () => {
    expect(detectHeartbeat('', [{ role: 'user', content: '' }], false)).toBe(true);
  });

  test('does NOT match short message when tools are present', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }];
    expect(detectHeartbeat('hi', messages, true)).toBe(false);
  });

  test('matches short messages under length threshold when no tools', () => {
    const messages = [{ role: 'user' as const, content: 'tell me something' }];
    expect(detectHeartbeat('tell me something', messages, false)).toBe(true);
  });

  test('does NOT match longer substantive messages', () => {
    const msg = 'What is the capital of France and what are its famous landmarks?';
    const messages = [{ role: 'user' as const, content: msg }];
    expect(detectHeartbeat(msg, messages, false)).toBe(false);
  });
});

describe('detectForcedTier', () => {
  test('detects USE SIMPLE', () => {
    expect(detectForcedTier('Please USE SIMPLE for this query')).toBe(Tier.SIMPLE);
  });

  test('detects USE MEDIUM case-insensitive', () => {
    expect(detectForcedTier('use medium routing')).toBe(Tier.MEDIUM);
  });

  test('detects USE COMPLEX', () => {
    expect(detectForcedTier('USE COMPLEX')).toBe(Tier.COMPLEX);
  });

  test('detects USE REASONING', () => {
    expect(detectForcedTier('I want USE REASONING for this proof')).toBe(Tier.REASONING);
  });

  test('detects USE HEARTBEAT', () => {
    expect(detectForcedTier('USE HEARTBEAT now')).toBe(Tier.HEARTBEAT);
  });

  test('returns null when no directive present', () => {
    expect(detectForcedTier('What is 2+2?')).toBeNull();
  });
});

describe('detectTokenOverflow', () => {
  test('returns false below threshold', () => {
    expect(detectTokenOverflow(999, 1000)).toBe(false);
  });

  test('returns false at threshold (not above)', () => {
    expect(detectTokenOverflow(100000, 100000)).toBe(false);
  });

  test('returns true above threshold', () => {
    expect(detectTokenOverflow(100001, 100000)).toBe(true);
  });
});

describe('runPhase1', () => {
  test('returns HEARTBEAT for "ping"', () => {
    const input = { messages: [{ role: 'user' as const, content: 'ping' }] };
    const result = runPhase1(input, DEFAULT_CLASSIFIER_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.HEARTBEAT);
    expect(result!.method).toBe('short-circuit');
    expect(result!.score).toBe(-1.0);
    expect(result!.confidence).toBe(0.95);
  });

  test('returns forced tier for USE COMPLEX directive', () => {
    const input = {
      messages: [{ role: 'user' as const, content: 'USE COMPLEX please route this' }],
    };
    const result = runPhase1(input, DEFAULT_CLASSIFIER_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.COMPLEX);
    expect(result!.confidence).toBe(1.0);
  });

  test('returns COMPLEX for token overflow', () => {
    // Create a very long message to trigger overflow
    const longContent = 'a'.repeat(400_001 * 4); // > 100k tokens
    const input = { messages: [{ role: 'user' as const, content: longContent }] };
    const result = runPhase1(input, DEFAULT_CLASSIFIER_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.COMPLEX);
    expect(result!.signals).toContain('token-overflow');
  });

  test('returns null for non-trivial message (proceeds to Phase 2)', () => {
    const input = {
      messages: [
        {
          role: 'user' as const,
          content: 'Write a detailed explanation of how binary search works.',
        },
      ],
    };
    const result = runPhase1(input, DEFAULT_CLASSIFIER_CONFIG);
    expect(result).toBeNull();
  });
});
