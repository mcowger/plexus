import { describe, expect, test } from 'vitest';
import type { UnifiedChatRequest } from '../../types/unified';
import { attachKeyAccessPolicy } from '../auth';

const fakeRequest = (keyConfig: Record<string, unknown>) => ({ keyConfig }) as any;

const unified = (overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest =>
  ({ model: 'gpt-6-luna', messages: [], ...overrides }) as UnifiedChatRequest;

describe('attachKeyAccessPolicy — per-key defaultServiceTier', () => {
  test('attaches the key default even when the key has no access lists', () => {
    const out = attachKeyAccessPolicy(fakeRequest({ defaultServiceTier: 'flex' }), unified());

    expect(out.metadata?.plexus_metadata?.defaultServiceTier).toBe('flex');
    expect(out.metadata?.plexus_metadata?.plexus_key_policy).toBeUndefined();
  });

  test('attaches both the default and the access policy when lists exist', () => {
    const out = attachKeyAccessPolicy(
      fakeRequest({ defaultServiceTier: 'priority', allowedModels: ['gpt-6-luna'] }),
      unified()
    );

    expect(out.metadata?.plexus_metadata?.defaultServiceTier).toBe('priority');
    expect(out.metadata?.plexus_metadata?.plexus_key_policy).toEqual({
      allowedModels: ['gpt-6-luna'],
    });
  });

  test('omits the default when the key has none', () => {
    const out = attachKeyAccessPolicy(fakeRequest({ allowedModels: ['gpt-6-luna'] }), unified());

    expect(out.metadata?.plexus_metadata?.defaultServiceTier).toBeUndefined();
  });

  test('returns the request unchanged when the key has neither lists nor a default', () => {
    const req = unified();

    expect(attachKeyAccessPolicy(fakeRequest({}), req)).toBe(req);
  });

  test('preserves existing metadata alongside the attached default', () => {
    const req = unified({
      metadata: {
        foo: 'bar',
        plexus_metadata: { oauthProvider: 'anthropic' },
      } as UnifiedChatRequest['metadata'],
    });

    const out = attachKeyAccessPolicy(fakeRequest({ defaultServiceTier: 'standard' }), req);

    expect(out.metadata?.plexus_metadata?.oauthProvider).toBe('anthropic');
    expect(out.metadata?.plexus_metadata?.defaultServiceTier).toBe('standard');
    expect((out.metadata as Record<string, unknown>).foo).toBe('bar');
  });

  test('does not write the default into originalBody', () => {
    const originalBody = { model: 'gpt-6-luna', messages: [], service_tier: 'auto' };

    attachKeyAccessPolicy(fakeRequest({ defaultServiceTier: 'flex' }), unified({ originalBody }));

    expect(originalBody.service_tier).toBe('auto');
  });
});
