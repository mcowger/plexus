export function getCheckerDisplayName(
  checkerType: string | undefined,
  checkerId: string,
  displayNameMap?: Map<string, string>
): string {
  if (checkerType && displayNameMap?.has(checkerType)) return displayNameMap.get(checkerType)!;
  if (checkerType) return checkerType;
  return checkerId;
}
