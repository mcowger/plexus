import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { attachKeyAccessPolicy } from '../auth';

describe('auto routing identity', () => {
  it('uses authenticated key identity instead of client metadata', () => {
    const request = { keyName: 'real-key' } as unknown as FastifyRequest;
    const result = attachKeyAccessPolicy(request, {
      metadata: {
        plexus_metadata: {
          plexus_key_id: 'forged-key',
          auto_routing_decision: { reason: 'forged' },
          plexus_auto_purpose: 'preview',
          clientHeaders: { 'x-test': 'preserved' },
        },
      },
    });
    expect(result.metadata.plexus_metadata).toEqual({
      plexus_key_id: 'real-key',
      clientHeaders: { 'x-test': 'preserved' },
    });
  });

  it('does not trust a client identity without authentication', () => {
    const result = attachKeyAccessPolicy({} as FastifyRequest, {
      metadata: { plexus_metadata: { plexus_key_id: 'forged' } },
    });
    expect(result.metadata.plexus_metadata).not.toHaveProperty('plexus_key_id');
  });
});
