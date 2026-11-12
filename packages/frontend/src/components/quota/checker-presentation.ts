import type { QuotaCheckerInfo } from '../../types/quota';

export function getCheckerDisplayName(
  checkerType: string | undefined,
  checkerId: string,
  displayNameMap?: Map<string, string>
): string {
  if (checkerType && displayNameMap?.has(checkerType)) return displayNameMap.get(checkerType)!;
  if (checkerType) return checkerType;
  return checkerId;
}

/**
 * Order checkers so entries for the same service sit together: display name
 * first, then provider/checker id for a deterministic order within a group.
 * Returns a new array; the input is left untouched.
 */
export function sortQuotaCheckersByDisplayName(
  quotas: QuotaCheckerInfo[],
  displayNameMap?: Map<string, string>
): QuotaCheckerInfo[] {
  return [...quotas].sort((a, b) => {
    const byName = getCheckerDisplayName(a.checkerType, a.checkerId, displayNameMap).localeCompare(
      getCheckerDisplayName(b.checkerType, b.checkerId, displayNameMap)
    );
    if (byName !== 0) return byName;
    const byProvider = (a.provider || a.checkerId).localeCompare(b.provider || b.checkerId);
    if (byProvider !== 0) return byProvider;
    return a.checkerId.localeCompare(b.checkerId);
  });
}
