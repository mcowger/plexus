import { describe, it, expect, beforeEach } from 'vitest';
import { setConfigForTesting } from '../../../config';
import { resolveGenerationIntent, splitReasoningSuffix } from '../generation-policy';
import type { ReasoningIntent } from '../reasoning';
import type { GenerationIntent } from '../generation';
import type { RouteResult } from '../../../services/router';

// pi-ai + logger globally mocked in test/vitest.setup.ts

function baseConfig(aliasGeneration?: any) {
  setConfigForTesting({
    providers: {},
    models: {
      'my-alias': {
        priority: 'selector',
        targets: [],
        ...(aliasGeneration ? { generation: aliasGeneration } : {}),
      },
    },
    keys: {},
    failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
    quotas: [],
  } as any);
}

function route(): RouteResult {
  return {
    provider: 'p',
    model: 'm',
    config: {} as any,
    canonicalModel: 'my-alias',
    incomingModelAlias: 'my-alias',
  };
}

function req(headers: Record<string, string> = {}, keyGeneration?: any): any {
  return { headers, keyConfig: keyGeneration ? { generation: keyGeneration } : undefined };
}

const gen = (o: Partial<GenerationIntent> = {}): GenerationIntent => ({
  reasoning: { source: 'client' },
  ...o,
});

const r = (o: Partial<ReasoningIntent> = {}): ReasoningIntent => ({ source: 'client', ...o });

describe('splitReasoningSuffix', () => {
  it('splits a recognised effort suffix', () => {
    expect(splitReasoningSuffix('gpt-5:high')).toEqual({
      alias: 'gpt-5',
      intent: { effort: 'high', enabled: true, source: 'client' },
    });
  });

  it('maps :off to disabled', () => {
    expect(splitReasoningSuffix('gpt-5:off')).toEqual({
      alias: 'gpt-5',
      intent: { enabled: false, source: 'client' },
    });
  });

  it('maps :max to xhigh', () => {
    expect(splitReasoningSuffix('opus:max').intent).toEqual({
      effort: 'xhigh',
      enabled: true,
      source: 'client',
    });
  });

  it('leaves an unrecognised suffix on the alias', () => {
    expect(splitReasoningSuffix('gemini-2.5:latest')).toEqual({ alias: 'gemini-2.5:latest' });
  });

  it('ignores a leading colon / no suffix', () => {
    expect(splitReasoningSuffix('plain-model')).toEqual({ alias: 'plain-model' });
  });
});

describe('resolveGenerationIntent — reasoning', () => {
  beforeEach(() => baseConfig());

  it('returns the request reasoning untouched when no policy', () => {
    const intent = gen({ reasoning: r({ effort: 'high', enabled: true }) });
    const out = resolveGenerationIntent({ requestIntent: intent, request: req(), route: route() });
    expect(out.reasoning).toEqual({ effort: 'high', enabled: true, source: 'client' });
  });

  it('header overrides the body reasoning', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen({ reasoning: r({ effort: 'low', enabled: true }) }),
      request: req({ 'x-plexus-reasoning': 'minimal' }),
      route: route(),
    });
    expect(out.reasoning).toEqual({ effort: 'minimal', enabled: true, source: 'header' });
  });

  it('suffix applies only when the body has no reasoning signal', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen(),
      suffixReasoning: r({ effort: 'high', enabled: true }),
      request: req(),
      route: route(),
    });
    expect(out.reasoning.effort).toBe('high');
  });

  it('falls back to key policy default when client said nothing', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen(),
      request: req({}, { reasoning: { default: 'medium' } }),
      route: route(),
    });
    expect(out.reasoning).toEqual({ effort: 'medium', enabled: true, source: 'key' });
  });

  it('falls back to alias policy default when no key policy', () => {
    baseConfig({ reasoning: { default: 'low' } });
    const out = resolveGenerationIntent({
      requestIntent: gen(),
      request: req(),
      route: route(),
    });
    expect(out.reasoning).toEqual({ effort: 'low', enabled: true, source: 'alias' });
  });

  it('applies ceiling clamp from alias policy', () => {
    baseConfig({ reasoning: { ceiling: 'medium' } });
    const out = resolveGenerationIntent({
      requestIntent: gen({ reasoning: r({ effort: 'xhigh', enabled: true }) }),
      request: req(),
      route: route(),
    });
    expect(out.reasoning.effort).toBe('medium');
  });

  it('applies floor clamp', () => {
    baseConfig({ reasoning: { floor: 'medium' } });
    const out = resolveGenerationIntent({
      requestIntent: gen({ reasoning: r({ effort: 'minimal', enabled: true }) }),
      request: req(),
      route: route(),
    });
    expect(out.reasoning.effort).toBe('medium');
  });

  it('allowClientOverride:false on key pins the policy default', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen({ reasoning: r({ effort: 'xhigh', enabled: true }) }),
      request: req({}, { reasoning: { default: 'low', allowClientOverride: false } }),
      route: route(),
    });
    expect(out.reasoning).toEqual({ effort: 'low', enabled: true, source: 'key' });
  });

  it('most-restrictive clamp wins across key and alias', () => {
    baseConfig({ reasoning: { ceiling: 'high' } });
    const out = resolveGenerationIntent({
      requestIntent: gen({ reasoning: r({ effort: 'xhigh', enabled: true }) }),
      request: req({}, { reasoning: { ceiling: 'low' } }),
      route: route(),
    });
    expect(out.reasoning.effort).toBe('low');
  });
});

describe('resolveGenerationIntent — maxTokens', () => {
  beforeEach(() => baseConfig());

  it('uses the client value when present', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen({ maxTokens: 1000 }),
      request: req(),
      route: route(),
    });
    expect(out.maxTokens).toBe(1000);
  });

  it('fills in the policy default when client omitted it', () => {
    baseConfig({ maxTokens: { default: 2048 } });
    const out = resolveGenerationIntent({
      requestIntent: gen(),
      request: req(),
      route: route(),
    });
    expect(out.maxTokens).toBe(2048);
  });

  it('caps the client value at the policy ceiling', () => {
    baseConfig({ maxTokens: { ceiling: 4096 } });
    const out = resolveGenerationIntent({
      requestIntent: gen({ maxTokens: 100000 }),
      request: req(),
      route: route(),
    });
    expect(out.maxTokens).toBe(4096);
  });

  it('key ceiling beats a looser alias ceiling', () => {
    baseConfig({ maxTokens: { ceiling: 8000 } });
    const out = resolveGenerationIntent({
      requestIntent: gen({ maxTokens: 100000 }),
      request: req({}, { maxTokens: { ceiling: 2000 } }),
      route: route(),
    });
    expect(out.maxTokens).toBe(2000);
  });
});

describe('resolveGenerationIntent — verbosity & serviceTier', () => {
  beforeEach(() => baseConfig());

  it('passes the client verbosity/serviceTier through', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen({ verbosity: 'high', serviceTier: 'flex' }),
      request: req(),
      route: route(),
    });
    expect(out.verbosity).toBe('high');
    expect(out.serviceTier).toBe('flex');
  });

  it('fills in policy defaults when omitted', () => {
    baseConfig({ verbosity: { default: 'low' }, serviceTier: { default: 'priority' } });
    const out = resolveGenerationIntent({
      requestIntent: gen(),
      request: req(),
      route: route(),
    });
    expect(out.verbosity).toBe('low');
    expect(out.serviceTier).toBe('priority');
  });

  it('pins verbosity when allowClientOverride is false', () => {
    const out = resolveGenerationIntent({
      requestIntent: gen({ verbosity: 'high' }),
      request: req({}, { verbosity: { default: 'low', allowClientOverride: false } }),
      route: route(),
    });
    expect(out.verbosity).toBe('low');
  });
});
