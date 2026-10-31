/**
 * Opt-in deep merge for management PATCH endpoints (`?merge=deep`).
 *
 * Plain PATCH spreads the body over the stored config, so a nested map such as a
 * provider's `models` is replaced whole. A caller that only wants to add one
 * model therefore has to resend every existing model, and any concurrent change
 * it did not read first is silently dropped. Deep merge lets a caller send just
 * the delta: object fields merge key-by-key, `null` removes a key, and arrays
 * and scalars replace.
 *
 * It stays opt-in because the admin UI depends on replace semantics (the
 * provider editor sends the full `models` map and expects removals to stick).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Merge `patch` into `current`: objects recurse, null deletes, everything else replaces. */
export function mergePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
      continue;
    }

    const existing = merged[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      merged[key] = mergePatch(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

/** True when the request asked for merge semantics via `?merge=deep` (or `?merge=true`). */
export function wantsDeepMerge(query: unknown): boolean {
  if (!isPlainObject(query)) return false;

  const flag = query.merge;
  const isMergeValue = (value: unknown) => value === 'deep' || value === 'true' || value === true;
  return Array.isArray(flag) ? flag.some(isMergeValue) : isMergeValue(flag);
}
