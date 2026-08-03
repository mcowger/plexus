import { describe, expect, it } from 'vitest';
import { OpenAITransformer } from '../openai';

/**
 * Cross-format reasoning translation: a Responses-API client (e.g. Claude
 * Code) sends `reasoning: { effort, summary }` (nested object). When Plexus
 * routes that to a Chat Completions provider, the nested object must be
 * translated to the Chat Completions top-level `reasoning_effort` string —
 * not forwarded verbatim, or strict upstreams reject the unknown
 * `reasoning.effort` field (UNKNOWN_FIELD). See issue #783.
 */
describe('OpenAITransformer.transformRequest — reasoning translation', () => {
  it('translates a nested reasoning object to top-level reasoning_effort (responses -> chat)', async () => {
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { effort: 'medium', summary: 'auto' },
      incomingApiType: 'responses',
      originalBody: {
        model: 'gpt-5',
        input: 'hi',
        reasoning: { effort: 'medium', summary: 'auto' },
      },
    } as any);

    expect(out.reasoning_effort).toBe('medium');
    // The Responses-style nested object must NOT leak onto a Chat Completions
    // payload — that is exactly the field strict upstreams reject.
    expect(out.reasoning).toBeUndefined();
  });

  it('maps each effort level through', async () => {
    const transformer = new OpenAITransformer();
    for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh'] as const) {
      const out = await transformer.transformRequest({
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort },
        incomingApiType: 'responses',
        originalBody: {},
      } as any);
      expect(out.reasoning_effort).toBe(effort);
      expect(out.reasoning).toBeUndefined();
    }
  });

  it('drops reasoning_effort when effort is "none" (thinking disabled)', async () => {
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { effort: 'none' },
      incomingApiType: 'responses',
      originalBody: {},
    } as any);

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
  });

  it('preserves a chat client originalBody verbatim on same-format (chat -> chat) pass-through', async () => {
    const transformer = new OpenAITransformer();
    // A chat client that speaks the OpenRouter-style nested `reasoning` object.
    const out = await transformer.transformRequest({
      model: 'or-model',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { effort: 'high' },
      incomingApiType: 'chat',
      originalBody: {
        model: 'or-model',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort: 'high' },
      },
    } as any);

    // Same-format keeps the client's nested object untouched (OpenRouter-style
    // upstreams accept it; auto-compat rewrites it downstream if needed).
    expect(out.reasoning).toEqual({ effort: 'high' });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it('omits reasoning entirely when the unified request carries none', async () => {
    const transformer = new OpenAITransformer();
    const out = await transformer.transformRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      incomingApiType: 'responses',
      originalBody: { model: 'gpt-4o', input: 'hi' },
    } as any);

    expect(out.reasoning).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });
});
