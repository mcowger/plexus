import { describe, expect, it } from 'vitest';
import { isAutoRoutingEnabled } from '../uiFeatures';
import type { Principal } from '../../types/settings';

const adminWith = (autoRouting: boolean): Principal => ({
  role: 'admin',
  uiFeatures: { autoRouting },
});

describe('isAutoRoutingEnabled', () => {
  it('is false when there is no principal (fail closed)', () => {
    expect(isAutoRoutingEnabled(null)).toBe(false);
    expect(isAutoRoutingEnabled(undefined)).toBe(false);
  });

  it('is false when the principal has no uiFeatures payload', () => {
    expect(isAutoRoutingEnabled({ role: 'admin' })).toBe(false);
  });

  it('is false when the flag is explicitly disabled', () => {
    expect(isAutoRoutingEnabled(adminWith(false))).toBe(false);
  });

  it('is true only when the backend explicitly enables the flag', () => {
    expect(isAutoRoutingEnabled(adminWith(true))).toBe(true);
  });
});
