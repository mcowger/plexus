/**
 * Stable per-installation identity for OAuth flows that need one.
 *
 * pi-ai's Sign in with ChatGPT flow identifies each installation by an "agent
 * host" URI (`urn:uuid:<uuid>`) and refuses to start without it. The ID is not
 * a secret, but it has to survive restarts: OpenAI expects the same value on
 * later logins from the same installation, so we persist it in system settings
 * (and therefore in backups).
 */

import { randomUUID } from 'node:crypto';

import { logger } from '../../utils/logger';
import { ConfigService } from '../configuration/config-service';

/** System-settings key holding the installation's agent host UUID. */
export const INSTALLATION_DEVICE_ID_SETTING = 'oauth.installationDeviceId';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads are cheap (one indexed row) and logins are rare, so there is no cache:
// a rotated or restored ID is picked up on the next login, and no module state
// leaks between tests in the shared test process.
async function readOrCreateDeviceId(): Promise<string> {
  const config = ConfigService.getInstance();
  const stored = await config.getSetting<string>(INSTALLATION_DEVICE_ID_SETTING, '');
  if (typeof stored === 'string' && UUID_PATTERN.test(stored)) {
    return stored;
  }

  const created = randomUUID();
  await config.setSetting(INSTALLATION_DEVICE_ID_SETTING, created);
  logger.info('Generated OAuth installation device ID', {
    setting: INSTALLATION_DEVICE_ID_SETTING,
  });
  return created;
}

/**
 * Resolve this installation's device ID, creating and persisting one on first
 * use. Throws only if the setting cannot be read or written.
 */
export function getInstallationDeviceId(): Promise<string> {
  return readOrCreateDeviceId();
}
