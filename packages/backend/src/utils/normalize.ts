export type BooleanLike = boolean | number | string | null | undefined;
export type TimestampLike = Date | number | string | null | undefined;

export function toBoolean(value: BooleanLike, fallback = false): boolean {
  if (value == null) return fallback;

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 't', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'f', 'no', 'n', 'off'].includes(normalized)) return false;

  return fallback;
}

export function toDbBoolean(value: BooleanLike): 0 | 1 {
  return toBoolean(value) ? 1 : 0;
}

export function toEpochMs(value: TimestampLike): number | null {
  if (value == null) return null;

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toIsoString(value: TimestampLike): string | null {
  const timestamp = toEpochMs(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}
