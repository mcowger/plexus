import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type UsageRecord, type UsageSummaryResponse } from '../../lib/api';
import {
  calcVelocity,
  formatBucketLabel,
  getRangeConfig,
  getSummaryBreakdown,
  toAggregatedPoint,
} from './helpers';
import type { AggregatedPoint, DetailedUsageData, UseDetailedUsageDataOptions } from './types';

export const useDetailedUsageData = ({
  timeRange,
  customDateRange,
  groupBy,
  viewMode,
}: UseDetailedUsageDataOptions): DetailedUsageData => {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [summaryResponse, setSummaryResponse] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestVersion = useRef(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const loadData = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError(false);
    try {
      let startDate: string | undefined;
      let endDate: string | undefined;

      if (timeRange === 'custom') {
        if (
          !customDateRange ||
          !Number.isFinite(customDateRange.start.getTime()) ||
          !Number.isFinite(customDateRange.end.getTime())
        ) {
          if (version === requestVersion.current) setLoading(false);
          return;
        }
        startDate = customDateRange.start.toISOString();
        endDate = customDateRange.end.toISOString();
      } else {
        const now = new Date();
        const { minutes } = getRangeConfig(timeRange);
        startDate = new Date(now.getTime() - minutes * 60000).toISOString();
        endDate = now.toISOString();
      }

      const summaryRange = timeRange === 'live' ? 'custom' : timeRange;
      const breakdown = getSummaryBreakdown(groupBy, viewMode);
      const summaryPromise = api
        .getUsageSummary(summaryRange, true, startDate, endDate, breakdown, 10)
        .then((response) => {
          if (!response) throw new Error('Usage analytics request failed');
          return response;
        });

      if (viewMode === 'list') {
        const [response, logsResponse] = await Promise.all([
          summaryPromise,
          api.getLogs(100, 0, {
            startDate,
            endDate,
            fields:
              'date,provider,incomingModelAlias,selectedModelName,responseStatus,tokensInput,tokensOutput,costTotal,durationMs,ttftMs,tokensPerSec',
          }),
        ]);
        if (version === requestVersion.current) {
          setSummaryResponse(response);
          setRecords(logsResponse.data || []);
        }
      } else {
        const response = await summaryPromise;
        if (version === requestVersion.current) {
          setSummaryResponse(response);
          setRecords([]);
        }
      }

      if (version === requestVersion.current) setLastUpdated(new Date());
    } catch (error) {
      if (version === requestVersion.current) {
        setLoadError(true);
        console.error('Failed to load usage data', error);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [timeRange, customDateRange, groupBy, viewMode, api]);

  useEffect(() => {
    loadData();
    if (timeRange === 'custom') return;

    const { minutes } = getRangeConfig(timeRange);
    const refreshInterval = minutes <= 60 ? 30000 : 60000;
    const interval = setInterval(loadData, refreshInterval);
    return () => clearInterval(interval);
  }, [loadData, timeRange]);

  const aggregatedData = useMemo<AggregatedPoint[]>(() => {
    if (groupBy === 'time') {
      const customRange = timeRange === 'custom' ? customDateRange : null;
      const data = (summaryResponse?.series ?? []).map((point) => ({
        name: formatBucketLabel(timeRange, point.bucketStartMs, customRange),
        requests: point.requests,
        errors: point.errors,
        tokens: point.tokens,
        cost: point.totalCost,
        duration: point.avgDurationMs,
        ttft: point.avgTtftMs,
        tps: point.avgTokensPerSec,
        successRate:
          point.requests > 0 ? ((point.requests - point.errors) / point.requests) * 100 : 0,
      }));
      return calcVelocity(data);
    }

    const breakdown = groupBy === 'model' ? 'modelAlias' : groupBy;
    return (summaryResponse?.grouped?.[breakdown]?.items ?? []).map(toAggregatedPoint);
  }, [summaryResponse, groupBy, timeRange, customDateRange]);

  return {
    records,
    summaryResponse,
    loading,
    loadError,
    lastUpdated,
    loadData,
    aggregatedData,
  };
};
