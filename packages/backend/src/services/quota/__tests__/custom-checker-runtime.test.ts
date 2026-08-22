import { describe, expect, it } from 'vitest';
import { createMeterContext } from '../checker-registry';
import {
  CustomCheckerError,
  runCustomChecker,
  validateCustomCheckerCode,
} from '../custom-checker-runtime';

describe('custom quota checker runtime', () => {
  it('executes a checker body and materializes meters in the host context', async () => {
    const ctx = createMeterContext('custom-checker', 'provider', {
      remaining: 12,
      apiKey: 'test-key',
      headers: { 'X-Project': 'demo' },
    });
    const meters = await runCustomChecker(
      `const headers = ctx.requestHeaders();
      return [ctx.balance({ key: 'credits', label: headers.Authorization === 'Bearer test-key' && headers['X-Project'] === 'demo' ? 'Credits' : 'Invalid', unit: 'usd', remaining: ctx.getOption('remaining', 0) })];`,
      ctx
    );

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      key: 'credits',
      remaining: 12,
      kind: 'balance',
      status: 'ok',
    });
  });

  it('reports syntax errors before starting a worker', () => {
    expect(() => validateCustomCheckerCode('return [')).toThrow(CustomCheckerError);
    try {
      validateCustomCheckerCode('return [');
    } catch (error) {
      expect(error).toMatchObject({ errorType: 'syntax' });
    }
  });

  it('terminates a checker that exceeds its timeout', async () => {
    const ctx = createMeterContext('custom-checker', 'provider', {});
    await expect(runCustomChecker('await new Promise(() => {});', ctx, 25)).rejects.toMatchObject({
      errorType: 'timeout',
    });
  });
});
