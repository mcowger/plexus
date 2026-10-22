import { describe, expect, it } from 'bun:test';

import {
  type CacheControlInjectionOptions,
  countCacheBreakpoints,
  injectCacheControlBreakpoints,
  MAX_CACHE_BREAKPOINTS,
} from '../cache-control-injection';

const EPHEMERAL = { type: 'ephemeral' };

const tools = () => [
  { name: 'Read', description: 'Read a file', input_schema: { type: 'object' } },
  { name: 'Bash', description: 'Run a command', input_schema: { type: 'object' } },
];

const text = (value: string) => ({ type: 'text', text: value });

const userTurn = (value: string) => ({ role: 'user', content: [text(value)] });
const assistantTurn = (value: string) => ({ role: 'assistant', content: [text(value)] });

const inject = (payload: any, options: CacheControlInjectionOptions = {}) =>
  injectCacheControlBreakpoints(payload, 'chat', 'messages', options);

describe('injectCacheControlBreakpoints', () => {
  it('marks the last tool, the last system block, and the two trailing messages', () => {
    const payload = {
      system: [text('first'), text('second')],
      tools: tools(),
      messages: [userTurn('one'), assistantTurn('two'), userTurn('three')],
    };

    const result = inject(payload);

    expect(result.sites).toEqual(['tools', 'system', 'messages[-2]', 'messages[-1]']);
    expect(result.payload.tools[0]).not.toHaveProperty('cache_control');
    expect(result.payload.tools[1].cache_control).toEqual(EPHEMERAL);
    expect(result.payload.system[0]).not.toHaveProperty('cache_control');
    expect(result.payload.system[1].cache_control).toEqual(EPHEMERAL);
    expect(result.payload.messages[0].content[0]).not.toHaveProperty('cache_control');
    expect(result.payload.messages[1].content[0].cache_control).toEqual(EPHEMERAL);
    expect(result.payload.messages[2].content[0].cache_control).toEqual(EPHEMERAL);
  });

  it('turns a bare string system prompt into a marked text block', () => {
    const result = inject({ system: 'You are a coding agent.', messages: [userTurn('hi')] });

    expect(result.payload.system).toEqual([
      { type: 'text', text: 'You are a coding agent.', cache_control: EPHEMERAL },
    ]);
  });

  it('skips a blank system prompt rather than spending a breakpoint on it', () => {
    const result = inject({ system: '   ', messages: [userTurn('hi')] });

    expect(result.sites).not.toContain('system');
    expect(result.payload.system).toBe('   ');
  });

  it('turns string message content into a marked text block', () => {
    const result = inject({ messages: [{ role: 'user', content: 'plain string' }] });

    expect(result.payload.messages[0].content).toEqual([
      { type: 'text', text: 'plain string', cache_control: EPHEMERAL },
    ]);
  });

  it('walks past thinking blocks to the last cacheable block of a message', () => {
    const payload = {
      messages: [
        userTurn('hi'),
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm', signature: 'sig' },
            text('answer'),
            { type: 'redacted_thinking', data: 'xyz' },
          ],
        },
      ],
    };

    const result = inject(payload);

    const content = result.payload.messages[1].content;
    expect(content[0]).not.toHaveProperty('cache_control');
    expect(content[1].cache_control).toEqual(EPHEMERAL);
    expect(content[2]).not.toHaveProperty('cache_control');
    expect(result.sites).toContain('messages[-1]');
  });

  it('skips messages with no cacheable content and keeps walking back', () => {
    const payload = {
      messages: [userTurn('one'), assistantTurn('two'), { role: 'user', content: [] }],
    };

    const result = inject(payload);

    expect(result.sites).toEqual(['messages[-3]', 'messages[-2]']);
    expect(result.payload.messages[2].content).toEqual([]);
    expect(result.payload.messages[1].content[0].cache_control).toEqual(EPHEMERAL);
    expect(result.payload.messages[0].content[0].cache_control).toEqual(EPHEMERAL);
  });

  it('never exceeds the four-breakpoint cap', () => {
    const payload = {
      system: 'system prompt',
      tools: tools(),
      messages: Array.from({ length: 8 }, (_, i) => userTurn(`turn ${i}`)),
    };

    const result = inject(payload, { messageBreakpoints: 4 });

    expect(result.sites).toHaveLength(MAX_CACHE_BREAKPOINTS);
    // tools + system consume two slots, leaving two for the conversation tail.
    expect(result.sites.filter((site) => site.startsWith('messages['))).toEqual([
      'messages[-2]',
      'messages[-1]',
    ]);
  });

  it('does not mark the conversation tail when message_breakpoints is 0', () => {
    const result = inject(
      { system: 'system prompt', tools: tools(), messages: [userTurn('hi')] },
      { messageBreakpoints: 0 }
    );

    expect(result.sites).toEqual(['tools', 'system']);
    expect(result.payload.messages[0].content[0]).not.toHaveProperty('cache_control');
  });

  it('uses the freed slots for trailing messages when tools/system are disabled', () => {
    const payload = {
      system: 'system prompt',
      tools: tools(),
      messages: Array.from({ length: 6 }, (_, i) => userTurn(`turn ${i}`)),
    };

    const result = inject(payload, {
      tools: false,
      system: false,
      messageBreakpoints: MAX_CACHE_BREAKPOINTS,
    });

    expect(result.sites).toEqual(['messages[-4]', 'messages[-3]', 'messages[-2]', 'messages[-1]']);
    expect(result.payload.tools[1]).not.toHaveProperty('cache_control');
    expect(result.payload.system).toBe('system prompt');
  });

  it('forwards an explicit 1h ttl and omits ttl by default', () => {
    const hour = inject({ system: 's', messages: [userTurn('hi')] }, { ttl: '1h' });
    expect(hour.payload.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    const defaultTtl = inject({ system: 's', messages: [userTurn('hi')] });
    expect(defaultTtl.payload.system[0].cache_control).toEqual(EPHEMERAL);

    const fiveMinutes = inject({ system: 's', messages: [userTurn('hi')] }, { ttl: '5m' });
    expect(fiveMinutes.payload.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('stands down entirely when the request already carries a breakpoint', () => {
    const marked = {
      system: [{ ...text('s'), cache_control: EPHEMERAL }],
      tools: tools(),
      messages: [userTurn('hi')],
    };

    const result = inject(marked);

    expect(result.payload).toBe(marked);
    expect(result.sites).toEqual([]);
    expect(result.payload.tools[1]).not.toHaveProperty('cache_control');
  });

  it('stands down when only the top-level automatic-caching field is set', () => {
    const marked = { cache_control: EPHEMERAL, system: 's', messages: [userTurn('hi')] };

    expect(inject(marked).payload).toBe(marked);
  });

  it('leaves native Messages clients alone', () => {
    const payload = { system: 's', tools: tools(), messages: [userTurn('hi')] };

    const result = injectCacheControlBreakpoints(payload, 'messages', 'messages', {});

    expect(result.payload).toBe(payload);
    expect(result.sites).toEqual([]);
  });

  it('leaves non-Messages targets alone', () => {
    const payload = { system: 's', tools: tools(), messages: [userTurn('hi')] };

    for (const target of ['chat', 'responses', 'gemini']) {
      expect(injectCacheControlBreakpoints(payload, 'chat', target, {}).payload).toBe(payload);
      expect(injectCacheControlBreakpoints(payload, 'chat', target, {}).sites).toEqual([]);
    }
  });

  it('does not mutate the payload it was given', () => {
    const payload = {
      system: 'system prompt',
      tools: tools(),
      messages: [userTurn('hi')],
    };
    const snapshot = structuredClone(payload);

    inject(payload);

    expect(payload).toEqual(snapshot);
  });
});

describe('countCacheBreakpoints', () => {
  it('counts every breakpoint location Anthropic honours', () => {
    const payload = {
      cache_control: EPHEMERAL,
      tools: [{ name: 'a' }, { name: 'b', cache_control: EPHEMERAL }],
      system: [{ ...text('s'), cache_control: EPHEMERAL }],
      messages: [
        { role: 'user', content: [text('hi')], cache_control: EPHEMERAL },
        {
          role: 'user',
          content: [text('a'), { ...text('b'), cache_control: EPHEMERAL }],
        },
      ],
    };

    expect(countCacheBreakpoints(payload)).toBe(5);
  });

  it('returns zero for a payload without breakpoints', () => {
    expect(countCacheBreakpoints({ system: 's', messages: [userTurn('hi')] })).toBe(0);
    expect(countCacheBreakpoints(null)).toBe(0);
  });
});
