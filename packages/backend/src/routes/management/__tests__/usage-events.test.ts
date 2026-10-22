import { afterEach, describe, expect, it } from 'bun:test';

import { UsageStorageService } from '../../../services/observability/usage-storage';
import { UsageEventsBroadcaster } from '../usage';

describe('UsageEventsBroadcaster', () => {
  let broadcaster: UsageEventsBroadcaster | null = null;

  afterEach(() => {
    broadcaster?.dispose();
    broadcaster = null;
  });

  it('keeps a single UsageStorageService listener regardless of connected SSE clients', () => {
    const usageStorage = new UsageStorageService();
    broadcaster = new UsageEventsBroadcaster(usageStorage);

    const received: Array<{ eventType: string; requestId: string }> = [];
    const cleanups: Array<() => void> = [];

    for (let index = 0; index < 12; index += 1) {
      cleanups.push(
        broadcaster.subscribe({
          scopeKey: index % 2 === 0 ? null : 'team-a',
          send: (eventType, record) => {
            received.push({
              eventType,
              requestId: record.requestId,
            });
          },
        })
      );
    }

    expect(usageStorage.listenerCount('started')).toBe(1);
    expect(usageStorage.listenerCount('updated')).toBe(1);
    expect(usageStorage.listenerCount('completed')).toBe(1);
    expect(usageStorage.listenerCount('created')).toBe(1);

    usageStorage.emit('started', { requestId: 'req-1', apiKey: 'team-a' });
    expect(received).toHaveLength(12);
    expect(received.every((entry) => entry.requestId === 'req-1')).toBe(true);

    usageStorage.emit('started', { requestId: 'req-2', apiKey: 'team-b' });
    expect(received).toHaveLength(18);
    expect(received.slice(12).every((entry) => entry.requestId === 'req-2')).toBe(true);

    for (const cleanup of cleanups) {
      cleanup();
    }

    expect(usageStorage.listenerCount('started')).toBe(1);

    broadcaster.dispose();
    expect(usageStorage.listenerCount('started')).toBe(0);
    expect(usageStorage.listenerCount('updated')).toBe(0);
    expect(usageStorage.listenerCount('completed')).toBe(0);
    expect(usageStorage.listenerCount('created')).toBe(0);
  });
});
