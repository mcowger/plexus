# Foglight-Style Metrics Dashboard Design

## Executive Summary

A new **Metrics** dashboard page inspired by Quest Foglight's enterprise monitoring interface. Features rich visualizations including heat maps, performance gauges, top-N lists, and real-time tickers for comprehensive LLM gateway monitoring.

## Key Features

1. **Time-Series Heatmap** - Token throughput by provider over time
2. **Performance Gauges** - Animated gauges for tokens/sec, requests/min
3. **Top-N Lists** - Busiest providers and models
4. **Alert Panel** - Active cooldowns and errors
5. **Sparkline Charts** - Mini trend charts for quick insights
6. **Live Request Ticker** - Scrolling recent requests
7. **Provider Health Grid** - Status matrix of all providers

## Widget Specifications

### 1. TimeSeriesHeatmap
- 2D grid: time (x-axis) vs provider (y-axis)
- Color intensity = token throughput
- Shows patterns in usage over time

### 2. PerformanceGauge
- Circular gauge with animated needle
- Shows current tokens/sec or requests/min
- Color zones: green (normal), yellow (warning), red (critical)

### 3. TopNProviderList
- Sorted list of top N providers by request count
- Shows sparkline of last hour
- Color-coded by health status

### 4. AlertSummaryPanel
- Collapsible panel showing active alerts
- Severity badges (critical, warning, info)
- Quick actions to clear cooldowns

### 5. MetricSparkline
- Mini line chart showing 1-hour trend
- No axes, just the line
- Shows metric at a glance

### 6. CorrelationScatter
- Scatter plot: latency vs tokens
- Bubble size = cost
- Shows request distribution patterns

### 7. LiveRequestTicker
- Horizontally scrolling recent requests
- Shows provider, model, status, tokens
- Pauses on hover

### 8. ProviderHealthGrid
- Grid of provider cards
- Each shows: status dot, request count, error rate
- Quick visual of system health

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER: Live Metrics                      [Auto-refresh]  │
├──────────────┬──────────────┬─────────────────────────────┤
│  GAUGE       │  GAUGE       │  HEALTH GRID (4x2)         │
│  Tokens/sec  │  Req/min     │  [p1] [p2] [p3] [p4]      │
│  [animation] │  [animation] │  [p5] [p6] [p7] [p8]      │
├──────────────┴──────────────┴─────────────────────────────┤
│  TIME-SERIES HEATMAP (Token throughput by provider/time)   │
├──────────────────────────────┬──────────────────────────────┤
│  TOP-N PROVIDERS            │  TOP-N MODELS              │
│  1. Provider A  [spark]    │  1. Model X [spark]         │
│  2. Provider B  [spark]    │  2. Model Y [spark]         │
│  3. Provider C  [spark]    │  3. Model Z [spark]         │
├──────────────────────────────┴──────────────────────────────┤
│  CORRELATION SCATTER (Latency vs Tokens)                    │
├──────────────────────────────┬──────────────────────────────┤
│  ALERT PANEL                 │  LIVE REQUEST TICKER        │
│  [3 Critical] [5 Warning]    │  [scrolling...]            │
│  [Alert details...]        │  provider | model | status │
└──────────────────────────────┴──────────────────────────────┘
```

## Technical Approach

### Dependencies
- Keep using recharts (already in project)
- Add framer-motion for animations
- Use CSS Grid for layout

### Color Scheme
- Heatmap: cool blues to hot reds
- Gauges: green (0-60%), yellow (60-80%), red (80-100%)
- Alerts: red (critical), orange (warning), blue (info)

### Performance
- Limit data points to last 100 requests
- Use requestAnimationFrame for animations
- Debounce updates to 500ms

## Implementation Phases

### Phase 1: Core Widgets
1. PerformanceGauge component
2. MetricSparkline component
3. TopNList component
4. LiveRequestTicker component

### Phase 2: Complex Visualizations
1. TimeSeriesHeatmap
2. CorrelationScatter
3. ProviderHealthGrid

### Phase 3: Integration
1. MetricsDashboard page
2. Sidebar navigation
3. App routing

### Phase 4: Polish
1. Animations
2. Responsive layout
3. Tooltips and interactions

## File Structure

```
packages/frontend/src/
├── components/
│   └── metrics/
│       ├── PerformanceGauge.tsx
│       ├── TimeSeriesHeatmap.tsx
│       ├── TopNList.tsx
│       ├── AlertSummary.tsx
│       ├── MetricSparkline.tsx
│       ├── CorrelationScatter.tsx
│       ├── LiveRequestTicker.tsx
│       ├── ProviderHealthGrid.tsx
│       └── index.ts
├── pages/
│   └── Metrics.tsx
└── lib/
    └── metrics-data.ts
```

## API Requirements

New endpoints needed:
- GET /v0/management/metrics/timeseries?provider=&start=&end=
- GET /v0/management/metrics/heatmap?start=&end=
- GET /v0/management/metrics/top?by=provider|model&limit=10

## Success Criteria

- All 8 widgets render correctly
- Animations are smooth (60fps)
- Data updates every 10 seconds
- Responsive on screens > 1200px
- Dark mode compatible
