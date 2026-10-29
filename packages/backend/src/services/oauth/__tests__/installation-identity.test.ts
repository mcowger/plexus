import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { ConfigService } from '../../configuration/config-service';
import { getInstallationDeviceId, INSTALLATION_DEVICE_ID_SETTING } from '../installation-identity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('installation identity', () => {
  let settings: Record<string, unknown>;
  let getSetting: ReturnType<typeof spyOn>;
  let setSetting: ReturnType<typeof spyOn>;

  beforeEach(() => {
    settings = {};
    getSetting = spyOn(ConfigService.getInstance(), 'getSetting').mockImplementation((async (
      key: string,
      fallback: unknown
    ) => (key in settings ? settings[key] : fallback)) as never);
    setSetting = spyOn(ConfigService.getInstance(), 'setSetting').mockImplementation((async (
      key: string,
      value: unknown
    ) => {
      settings[key] = value;
    }) as never);
  });

  it('creates and persists a UUID on first use', async () => {
    const deviceId = await getInstallationDeviceId();

    expect(deviceId).toMatch(UUID_PATTERN);
    expect(setSetting).toHaveBeenCalledWith(INSTALLATION_DEVICE_ID_SETTING, deviceId);
  });

  it('returns the stored id instead of generating a new one', async () => {
    const stored = '11111111-2222-3333-4444-555555555555';
    settings[INSTALLATION_DEVICE_ID_SETTING] = stored;

    expect(await getInstallationDeviceId()).toBe(stored);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('replaces a stored value that is not a UUID', async () => {
    settings[INSTALLATION_DEVICE_ID_SETTING] = 'not-a-uuid';

    const deviceId = await getInstallationDeviceId();

    expect(deviceId).toMatch(UUID_PATTERN);
    expect(setSetting).toHaveBeenCalledWith(INSTALLATION_DEVICE_ID_SETTING, deviceId);
  });

  it('keeps the same id across calls (no per-login churn)', async () => {
    const first = await getInstallationDeviceId();
    const second = await getInstallationDeviceId();

    expect(second).toBe(first);
    expect(getSetting).toHaveBeenCalledTimes(2);
  });
});
