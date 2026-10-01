/**
 * UI-only feature flags exposed to the admin frontend via the auth/verify
 * response. These gate presentation only; they never enable or disable
 * inference or API behaviour.
 *
 * Flags are read from the environment on each call (truth-only: only the
 * exact string "true" enables a flag) so `auth/verify` reflects the current
 * process environment without extra config plumbing.
 */
export interface UiFeatures {
  autoRouting: boolean;
}

export function getUiFeatures(): UiFeatures {
  return {
    autoRouting: process.env.PLEXUS_UI_AUTO_ROUTING === 'true',
  };
}
