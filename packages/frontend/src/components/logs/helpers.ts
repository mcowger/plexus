export const formatReasoningEffort = (effort?: string | null): string | null => {
  if (!effort) return null;
  return effort.charAt(0).toUpperCase() + effort.slice(1);
};

export const formatDateSafely = (dateStr: string | undefined | null) => {
  if (!dateStr) return { time: '-', date: '-' };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { time: 'Invalid', date: 'Date' };
    return {
      time: d.toLocaleTimeString(),
      date: d.toISOString().split('T')[0],
    };
  } catch {
    return { time: 'Error', date: 'Date' };
  }
};
