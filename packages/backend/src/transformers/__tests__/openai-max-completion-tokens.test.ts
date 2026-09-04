import { describe, expect, it } from 'vitest';
import { OpenAITransformer } from '../openai';
import { buildAnthropicRequest } from '../anthropic/request-builder';
import type { UnifiedChatRequest } from '../../types/unified';

/**
 * Regression tests for https://github.com/mcowger/plexus/issues/849:
 * `max_completion_tokens` (the non-deprecated Chat Completions spelling,
 * required by o-series/GPT-5-style reasoning models) was silently dropped by
 * OpenAITransformer.parseRequest, so cross-format routes lost the caller's
 * output budget (Anthropic fell back to `max_tokens: 4096`).
 */

const MESSAGES = [{ role: 'user', content: 'hi' }];

async function parse(body: any) {
  const transformer = new OpenAITransformer();
  const unified = await transformer.parseRequest(body);
  unified.incomingApiType = 'chat';
  unified.originalBody = body;
  return unified;
}

describe('parseRequest max_completion_tokens normalization', () => {
  it('normalizes max_completion_tokens-only into unified max_tokens', async () => {
    const unified = await parse({
      model: 'alias-A',
      messages: MESSAGES,
      max_completion_tokens: 393216,
    });
    expect(unified.max_tokens).toBe(393216);
  });

  it('keeps unified max_tokens absent when the caller sent neither spelling', async () => {
    const unified = await parse({ model: 'alias-A', messages: MESSAGES });
    expect(unified.max_tokens).toBeUndefined();
    expect('max_tokens' in unified).toBe(false);
  });

  it('prefers max_completion_tokens when both spellings are present', async () => {
    const unified = await parse({
      model: 'alias-A',
      messages: MESSAGES,
      max_tokens: 100,
      max_completion_tokens: 200,
    });
    expect(unified.max_tokens).toBe(200);
  });

  it('still reads legacy max_tokens', async () => {
    const unified = await parse({ model: 'alias-A', messages: MESSAGES, max_tokens: 512 });
    expect(unified.max_tokens).toBe(512);
  });
});

describe('cross-format emission (chat -> messages)', () => {
  it('forwards the max_completion_tokens budget instead of defaulting to 4096', async () => {
    const unified = await parse({
      model: 'alias-A',
      messages: MESSAGES,
      max_completion_tokens: 393216,
    });
    const out = await buildAnthropicRequest({ ...unified, model: 'upstream-A' });
    expect(out.max_tokens).toBe(393216);
  });

  it('still defaults to 4096 when the caller sent no budget', async () => {
    const unified = await parse({ model: 'alias-A', messages: MESSAGES });
    const out = await buildAnthropicRequest({ ...unified, model: 'upstream-A' });
    expect(out.max_tokens).toBe(4096);
  });
});

describe('same-format emission (chat -> chat, non-bypass transform path)', () => {
  it('emits max_completion_tokens (not max_tokens) when the caller sent only that spelling', async () => {
    const unified = await parse({
      model: 'alias-B',
      messages: MESSAGES,
      max_completion_tokens: 131072,
    });
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest(unified);
    expect(out.max_completion_tokens).toBe(131072);
    expect('max_tokens' in out).toBe(false);
  });

  it('emits max_tokens when the caller sent only the legacy spelling', async () => {
    const unified = await parse({ model: 'alias-B', messages: MESSAGES, max_tokens: 512 });
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest(unified);
    expect(out.max_tokens).toBe(512);
    expect('max_completion_tokens' in out).toBe(false);
  });

  it('emits no budget key when the caller sent neither', async () => {
    const unified = await parse({ model: 'alias-B', messages: MESSAGES });
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest(unified);
    expect('max_tokens' in out).toBe(false);
    expect('max_completion_tokens' in out).toBe(false);
  });

  it('emits only max_completion_tokens when the caller sent both spellings', async () => {
    const unified = await parse({
      model: 'alias-B',
      messages: MESSAGES,
      max_tokens: 100,
      max_completion_tokens: 200,
    });
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest(unified);
    expect(out.max_completion_tokens).toBe(200);
    expect('max_tokens' in out).toBe(false);
  });

  it('ignores non-numeric budget values at parse time', async () => {
    const unified = await parse({
      model: 'alias-B',
      messages: MESSAGES,
      max_completion_tokens: 'lots' as any,
    });
    expect('max_tokens' in unified).toBe(false);
  });

  it('ignores a garbage mct without dropping a valid legacy max_tokens', async () => {
    const unified = await parse({
      model: 'alias-B',
      messages: MESSAGES,
      max_tokens: 512,
      max_completion_tokens: '1024' as any,
    });
    expect(unified.max_tokens).toBe(512);
  });

  it('passes an invalid caller budget through untouched so the upstream 400s', async () => {
    const unified = await parse({
      model: 'alias-B',
      messages: MESSAGES,
      max_completion_tokens: 'lots' as any,
    });
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest(unified);
    expect(out.max_completion_tokens).toBe('lots');
    expect('max_tokens' in out).toBe(false);
  });
});

describe('enforce-limits pickup', () => {
  it('reserves the normalized budget (covered via unified max_tokens)', async () => {
    // enforceContextLimit reads request.max_tokens; entrance normalization
    // means max_completion_tokens callers are enforced against their real
    // budget rather than the 4096 fallback.
    const unified = await parse({
      model: 'alias-A',
      messages: MESSAGES,
      max_completion_tokens: 800,
    });
    expect(unified.max_tokens).toBe(800);
    const unifiedRecord = unified as UnifiedChatRequest;
    expect(typeof unifiedRecord.max_tokens).toBe('number');
  });
});
