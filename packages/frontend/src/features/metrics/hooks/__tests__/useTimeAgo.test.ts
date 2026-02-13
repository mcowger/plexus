import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimeAgo } from '../useTimeAgo';

// Mock the format module
vi.mock('../../../../lib/format', () => ({
  formatTimeAgo: vi.fn((seconds: number) => `${seconds}s ago`),
}));

describe('useTimeAgo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with "Just now"', () => {
    const { result } = renderHook(() => useTimeAgo());

    expect(result.current.timeAgo).toBe('Just now');
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
  });

  it('should update time ago on refresh interval', () => {
    const { result } = renderHook(() => useTimeAgo({ refreshInterval: 5000 }));

    // Initially "Just now"
    expect(result.current.timeAgo).toBe('Just now');

    // Advance time past threshold
    vi.advanceTimersByTime(5000);

    expect(result.current.timeAgo).toBe('5s ago');
  });

  it('should allow manual update of lastUpdated', () => {
    const { result } = renderHook(() => useTimeAgo());

    const initialLastUpdated = result.current.lastUpdated;

    // Advance time
    vi.advanceTimersByTime(1000);

    act(() => {
      result.current.updateLastUpdated();
    });

    expect(result.current.lastUpdated.getTime()).toBeGreaterThan(initialLastUpdated.getTime());
    expect(result.current.timeAgo).toBe('Just now');
  });

  it('should return "Just now" when less than 5 seconds', () => {
    const { result } = renderHook(() => useTimeAgo());

    // Advance by 3 seconds
    vi.advanceTimersByTime(3000);

    expect(result.current.timeAgo).toBe('Just now');
  });

  it('should clean up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() => useTimeAgo());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
