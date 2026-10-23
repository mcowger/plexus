import { describe, expect, it } from 'bun:test';

import type { ModelBehavior } from '../../../config';
import { applyModelBehaviors, type BehaviorContext } from '../model-behaviors';

const EPHEMERAL = { type: 'ephemeral' };

const text = (value: string) => ({ type: 'text', text: value });

const payload = () => ({
  system: 'You are a coding agent.',
  tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
  messages: [
    { role: 'user', content: [text('first')] },
    { role: 'assistant', content: [text('reply')] },
    { role: 'user', content: [text('second')] },
  ],
});

const ctx = (overrides: Partial<BehaviorContext> = {}): BehaviorContext => ({
  incomingApiType: 'chat',
  canonicalModel: 'claude-alias',
  targetApiType: 'messages',
  ...overrides,
});

const cacheControl = (overrides: Record<string, unknown> = {}) => [
  { type: 'inject_cache_control', ...overrides } as unknown as ModelBehavior,
];

describe('applyModelBehaviors inject_cache_control', () => {
  it('auto-enables on Anthropic-owned routes with schema defaults', () => {
    const result = applyModelBehaviors(payload(), undefined, ctx({ autoEnableCacheControl: true }));

    expect(result.tools.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(result.system.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(result.messages.at(-1).content.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(result.messages.at(-2).content.at(-1).cache_control).toEqual(EPHEMERAL);
  });

  it('stays off elsewhere unless the alias opts in', () => {
    const untouched = payload();
    expect(applyModelBehaviors(untouched, undefined, ctx()).tools.at(-1)).not.toHaveProperty(
      'cache_control'
    );

    const optedIn = applyModelBehaviors(payload(), cacheControl(), ctx());
    expect(optedIn.tools.at(-1).cache_control).toEqual(EPHEMERAL);
  });

  it('lets an explicit opt-out win over auto-enable', () => {
    const result = applyModelBehaviors(
      payload(),
      cacheControl({ enabled: false }),
      ctx({ autoEnableCacheControl: true })
    );

    expect(result.tools.at(-1)).not.toHaveProperty('cache_control');
    expect(result.system).toBe('You are a coding agent.');
  });

  it('skips the system site when masking will rebuild the system prompt', () => {
    const result = applyModelBehaviors(
      payload(),
      undefined,
      ctx({ autoEnableCacheControl: true, systemRewrittenByMasking: true })
    );

    // The masked system prompt is replaced after behaviors run, so marking it
    // would be discarded; the original value passes through untouched.
    expect(result.system).toBe('You are a coding agent.');
    expect(result.tools.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(result.messages.at(-1).content.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(result.messages.at(-2).content.at(-1).cache_control).toEqual(EPHEMERAL);
  });

  it('still honors a configured trailing depth when masking skips system', () => {
    const result = applyModelBehaviors(
      payload(),
      cacheControl({ message_breakpoints: 3 }),
      ctx({ systemRewrittenByMasking: true })
    );

    expect(result.system).toBe('You are a coding agent.');
    expect(result.messages.map((message: any) => message.content.at(-1).cache_control)).toEqual([
      EPHEMERAL,
      EPHEMERAL,
      EPHEMERAL,
    ]);
  });
});

describe('applyModelBehaviors strip_adaptive_thinking', () => {
  it('still removes adaptive thinking on the Messages path', () => {
    const result = applyModelBehaviors(
      { thinking: { type: 'adaptive' }, messages: [] },
      [{ type: 'strip_adaptive_thinking', enabled: true }],
      ctx({ incomingApiType: 'messages' })
    );

    expect(result).not.toHaveProperty('thinking');
  });
});
