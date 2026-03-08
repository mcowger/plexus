/**
 * Date range utilities for usage analysis
 */

export type DateRangePreset = 'today' | 'this-week' | 'this-month' | 'last-month';

export interface CustomDateRange {
  start: Date;
  end: Date;
}

/**
 * Get a date range for a predefined preset
 */
export function getPresetRange(preset: DateRangePreset): CustomDateRange {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (preset) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;

    case 'this-week':
      // Start from beginning of current week (Sunday)
      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;

    case 'this-month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;

    case 'last-month':
      // First day of previous month
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      // Last day of previous month
      end.setDate(0); // Day 0 of current month = last day of previous month
      end.setHours(23, 59, 59, 999);
      break;
  }

  return { start, end };
}

/**
 * Format a date range for display
 */
export function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };

  const startDate = start.toLocaleDateString('en-US', options);
  const endDate = end.toLocaleDateString('en-US', options);

  if (startDate === endDate) {
    return startDate;
  }

  return `${startDate} - ${endDate}`;
}

/**
 * Check if a date range is valid (end >= start, not in future)
 */
export function isValidDateRange(start: Date, end: Date): boolean {
  if (!start || !end) return false;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  if (end < start) return false;

  // Optional: prevent dates too far in the future
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  if (end > tomorrow) return false;

  return true;
}

/**
 * Parse an ISO date string safely
 */
export function parseISODate(dateString: string): Date | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;

  return date;
}

/**
 * Format a date to ISO string for URL parameters
 */
export function formatISODate(date: Date): string {
  return date.toISOString();
}

/**
 * Get the start and end dates for a time range (existing functionality)
 */
export function getTimeRangeBounds(range: 'hour' | 'day' | 'week' | 'month'): CustomDateRange {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);

  switch (range) {
    case 'hour':
      start.setHours(start.getHours() - 1);
      break;
    case 'day':
      start.setHours(start.getHours() - 24);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'month':
      start.setDate(start.getDate() - 30);
      break;
  }

  return { start, end };
}
