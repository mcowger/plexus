import type { Principal } from '../types/settings';

/**
 * True only when the backend explicitly advertised the auto-routing UI flag.
 * Missing principals, missing flags, and malformed values all resolve to false
 * (fail closed) so the controls stay hidden unless the backend enables them.
 */
export function isAutoRoutingEnabled(principal: Principal | null | undefined): boolean {
  return principal?.uiFeatures?.autoRouting === true;
}
