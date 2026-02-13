import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUsageEvents } from '../useUsageEvents';
import { api } from '../../../../lib/api';

// Mock the API module
vi.mock('../../../../lib/api', () => ({
  api: {
    subscribeToUsageEvents: vi.fn(),
  },
}));

describe('useUsageEvents', () => {
  const mockUnsubscribe = vi.fn();
  let mockOnLog: (record: unknown) => void = () => {};
  let mockOnError: (event: Event) => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.mocked(api.subscribeToUsageEvents).mockImplementation(({ onLog, onError }) => {
      mockOnLog = onLog;
      mockOnError = onError || (() => {});
      return mockUnsubscribe;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should subscribe to usage events on mount', () => {
    const onLog = vi.fn();

    renderHook(() => useUsageEvents({ onLog }));

    expect(api.subscribeToUsageEvents).toHaveBeenCalledWith({
      onLog: expect.any(Function),
      onError: expect.any(Function),
    });
  });

  it('should call onLog when event is received', async () => {
    const onLog = vi.fn();
    const mockRecord = { requestId: '123', provider: 'test' };

    renderHook(() => useUsageEvents({ onLog, debounceMs: 0 }));

    // Simulate receiving an event
    mockOnLog(mockRecord);

    await waitFor(() => {
      expect(onLog).toHaveBeenCalledWith(mockRecord);
    });
  });

  it('should debounce onLog calls', async () => {
    const onLog = vi.fn();

    renderHook(() => useUsageEvents({ onLog, debounceMs: 500 }));

    // Simulate multiple rapid events
    mockOnLog({ id: 1 });
    mockOnLog({ id: 2 });
    mockOnLog({ id: 3 });

    // Before debounce time
    expect(onLog).not.toHaveBeenCalled();

    // Advance past debounce time
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      // Should only be called once with the last value
      expect(onLog).toHaveBeenCalledTimes(1);
      expect(onLog).toHaveBeenCalledWith({ id: 3 });
    });
  });

  it('should set isConnected to true on log event', async () => {
    const onLog = vi.fn();

    const { result } = renderHook(() => useUsageEvents({ onLog, debounceMs: 0 }));

    expect(result.current.isConnected).toBe(true);

    mockOnLog({});

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('should set isConnected to false on error', () => {
    const onLog = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useUsageEvents({ onLog, onError }));

    expect(result.current.isConnected).toBe(true);

    // Simulate error
    const errorEvent = new Event('error');
    mockOnError(errorEvent);

    expect(result.current.isConnected).toBe(false);
    expect(onError).toHaveBeenCalledWith(errorEvent);
  });

  it('should unsubscribe on unmount', () => {
    const onLog = vi.fn();

    const { unmount } = renderHook(() => useUsageEvents({ onLog }));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should allow manual reconnect', () => {
    const onLog = vi.fn();

    const { result } = renderHook(() => useUsageEvents({ onLog }));

    result.current.reconnect();

    // Should have unsubscribed and resubscribed
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(api.subscribeToUsageEvents).toHaveBeenCalledTimes(2);
  });
});
