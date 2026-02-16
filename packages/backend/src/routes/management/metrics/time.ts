/**
 * Time range utilities for metrics module
 */

import { TimeRange } from './types';

export interface TimeRangeBounds {
    startTime: number;
    endTime: number;
    granularity: 'minute' | 'hour' | 'day';
}

export function getTimeRangeBounds(range: TimeRange): TimeRangeBounds {
    const now = new Date();
    now.setSeconds(0, 0);
    const endTime = now.getTime();
    const startTime = new Date(now);

    let granularity: 'minute' | 'hour' | 'day' = 'hour';

    switch (range) {
        case 'hour':
            startTime.setHours(startTime.getHours() - 1);
            granularity = 'minute';
            break;
        case 'day':
            startTime.setHours(startTime.getHours() - 24);
            granularity = 'hour';
            break;
        case 'week':
            startTime.setDate(startTime.getDate() - 7);
            granularity = 'day';
            break;
        case 'month':
            startTime.setDate(startTime.getDate() - 30);
            granularity = 'day';
            break;
    }

    return { startTime: startTime.getTime(), endTime, granularity };
}

export function getBucketFormat(range: TimeRange): (timestamp: number) => string {
    switch (range) {
        case 'hour':
        case 'day':
            return (ts: number) => {
                const date = new Date(ts);
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            };
        case 'week':
        case 'month':
        default:
            return (ts: number) => {
                const date = new Date(ts);
                return date.toLocaleDateString();
            };
    }
}

export function getStepMs(granularity: 'minute' | 'hour' | 'day'): number {
    switch (granularity) {
        case 'minute':
            return 60 * 1000;
        case 'hour':
            return 60 * 60 * 1000;
        case 'day':
            return 24 * 60 * 60 * 1000;
        default:
            return 60 * 60 * 1000;
    }
}
