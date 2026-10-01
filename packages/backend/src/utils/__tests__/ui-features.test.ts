import { afterEach, describe, expect, test } from 'vitest';
import { getUiFeatures } from '../ui-features';

const originalAutoRouting = process.env.PLEXUS_UI_AUTO_ROUTING;

afterEach(() => {
  if (originalAutoRouting === undefined) {
    delete process.env.PLEXUS_UI_AUTO_ROUTING;
  } else {
    process.env.PLEXUS_UI_AUTO_ROUTING = originalAutoRouting;
  }
});

describe('getUiFeatures', () => {
  test('defaults autoRouting to false when the env var is missing', () => {
    delete process.env.PLEXUS_UI_AUTO_ROUTING;
    expect(getUiFeatures()).toEqual({ autoRouting: false });
  });

  test('keeps autoRouting false for non-"true" values', () => {
    process.env.PLEXUS_UI_AUTO_ROUTING = 'false';
    expect(getUiFeatures()).toEqual({ autoRouting: false });

    process.env.PLEXUS_UI_AUTO_ROUTING = 'TRUE';
    expect(getUiFeatures()).toEqual({ autoRouting: false });

    process.env.PLEXUS_UI_AUTO_ROUTING = '1';
    expect(getUiFeatures()).toEqual({ autoRouting: false });
  });

  test('enables autoRouting only for the exact string "true"', () => {
    process.env.PLEXUS_UI_AUTO_ROUTING = 'true';
    expect(getUiFeatures()).toEqual({ autoRouting: true });
  });
});
