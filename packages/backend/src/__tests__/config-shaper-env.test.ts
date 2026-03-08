import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { validateConfig } from '../config';

const ENV_KEYS = [
  'PLEXUS_SHAPER_QUEUE_TIMEOUT_MS',
  'PLEXUS_SHAPER_CLEANUP_INTERVAL_MS',
  'PLEXUS_SHAPER_DEFAULT_RPM',
] as const;

const makeConfigYaml = (rateLimitYaml?: string): string => `
providers:
  shaped-provider:
    api_base_url: "https://api.example.com/v1"
    api_key: "test-api-key"
${rateLimitYaml ? rateLimitYaml : ''}
models:
  test-model:
    targets:
      - provider: shaped-provider
        model: provider-model
keys: {}
adminKey: "admin-secret"
`;

const inlineRateLimit = (body: string): string => `    rate_limit:
${body}`;

const makeModelRateLimitYaml = (): string => `
providers:
  shaped-provider:
    api_base_url: "https://api.example.com/v1"
    api_key: "test-api-key"
    models:
      model-a:
        rate_limit:
          queue_depth: 4
      model-b: {}
models:
  test-model:
    targets:
      - provider: shaped-provider
        model: model-a
keys: {}
adminKey: "admin-secret"
`;

describe('config shaper env defaults', () => {
  let envSnapshot: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
      (typeof ENV_KEYS)[number],
      string | undefined
    >;

    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = envSnapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('keeps providers without rate_limit unchanged', () => {
    process.env.PLEXUS_SHAPER_QUEUE_TIMEOUT_MS = '45000';
    process.env.PLEXUS_SHAPER_DEFAULT_RPM = '25';

    const config = validateConfig(makeConfigYaml());

    expect(config.providers['shaped-provider'].rate_limit).toBeUndefined();
    expect(config.shaper).toMatchObject({
      queueTimeoutMs: 45000,
      cleanupIntervalMs: 60000,
      defaultRpm: 25,
    });
  });

  it('applies env defaults when rate_limit opts in with missing values', () => {
    process.env.PLEXUS_SHAPER_QUEUE_TIMEOUT_MS = '45000';
    process.env.PLEXUS_SHAPER_DEFAULT_RPM = '25';

    const config = validateConfig(makeConfigYaml(inlineRateLimit('      queue_depth: 3\n')));

    expect(config.providers['shaped-provider'].rate_limit).toEqual({
      requests_per_minute: 25,
      queue_depth: 3,
      queue_timeout_ms: 45000,
    });
  });

  it('preserves explicit rate_limit values over env defaults', () => {
    process.env.PLEXUS_SHAPER_QUEUE_TIMEOUT_MS = '45000';
    process.env.PLEXUS_SHAPER_DEFAULT_RPM = '25';

    const config = validateConfig(
      makeConfigYaml(
        inlineRateLimit(
          '      requests_per_minute: 10\n      queue_depth: 2\n      queue_timeout_ms: 12000\n'
        )
      )
    );

    expect(config.providers['shaped-provider'].rate_limit).toEqual({
      requests_per_minute: 10,
      queue_depth: 2,
      queue_timeout_ms: 12000,
    });
  });

  it('falls back safely when env values are invalid', () => {
    process.env.PLEXUS_SHAPER_QUEUE_TIMEOUT_MS = 'invalid';
    process.env.PLEXUS_SHAPER_CLEANUP_INTERVAL_MS = '0';
    process.env.PLEXUS_SHAPER_DEFAULT_RPM = '-10';

    const config = validateConfig(makeConfigYaml(inlineRateLimit('      queue_depth: 4\n')));

    expect(config.providers['shaped-provider'].rate_limit).toEqual({
      requests_per_minute: 60,
      queue_depth: 4,
      queue_timeout_ms: 30000,
    });
    expect(config.shaper).toMatchObject({
      queueTimeoutMs: 30000,
      cleanupIntervalMs: 60000,
      defaultRpm: 60,
    });
  });

  it('hydrates model-level rate_limit values with env defaults', () => {
    process.env.PLEXUS_SHAPER_QUEUE_TIMEOUT_MS = '9100';
    process.env.PLEXUS_SHAPER_DEFAULT_RPM = '13';

    const config = validateConfig(makeModelRateLimitYaml());
    const models = config.providers['shaped-provider'].models;

    expect(models).not.toBeUndefined();
    expect(Array.isArray(models)).toBe(false);

    if (!models || Array.isArray(models)) {
      throw new Error('Expected provider models to be a keyed model config record');
    }

    expect(models['model-a']).toMatchObject({
      rate_limit: {
        requests_per_minute: 13,
        queue_depth: 4,
        queue_timeout_ms: 9100,
      },
    });
    expect(models['model-b']).toMatchObject({});
    expect(models['model-b']?.rate_limit).toBeUndefined();
  });
});
