# Merge Summary: feature/gap-analysis-next-level → main

**Date:** 2026-02-16
**Source:** feature/gap-analysis-next-level (rebased on mcowger/main)
**Target:** main (TheArchitectit/plexus)

---

## Overview

This merge incorporates comprehensive dashboard improvements and a new metrics system from the feature branch, while maintaining synchronization with upstream mcowger/plexus changes.

---

## Key Changes

### 1. Frontend Dashboard (packages/frontend)

#### New Pages
- **Metrics.tsx** - System metrics dashboard with time-series charts
- **LiveMetrics.tsx** - Real-time streaming metrics display
- **DetailedUsage.tsx** - Detailed usage breakdown with filtering

#### Enhanced Sidebar (Sidebar.tsx)
Added navigation items:
- `/` - Dashboard (LayoutDashboard icon)
- `/metrics` - Metrics (Gauge icon)
- `/live-metrics` - Live Metrics (Zap icon)
- `/detailed-usage` - Detailed Usage (BarChart3 icon)
- `/usage` - Usage (Activity icon)
- `/performance` - Performance (Gauge icon)
- `/logs` - Logs (FileText icon)

#### New Quota Components
- `MiniMaxQuotaConfig.tsx` / `MiniMaxQuotaDisplay.tsx`
- `OpenRouterQuotaConfig.tsx` / `OpenRouterQuotaDisplay.tsx`

#### Auto-login Script
- Added to `index.html` for development convenience
- Sets default admin key in localStorage

#### API Updates (lib/api.ts)
- New metrics endpoints
- Enhanced quota management APIs
- Time-series data fetching

---

### 2. Backend Metrics System (packages/backend)

#### New Routes (`/routes/management/metrics/`)
```
├── aggregation.ts    # Data aggregation logic
├── cache.ts          # Caching layer
├── index.ts          # Route registration
├── queries.ts        # Database queries
├── stream.ts         # Streaming support
├── time.ts           # Time utilities
├── types.ts          # Type definitions
└── routes/
    ├── aggregated.ts
    ├── chart-data.ts
    ├── index.ts
    └── stats.ts
```

#### New Services
- `metrics-service.ts` - Core metrics service
- `usage-normalizer.ts` - Usage data normalization

#### Enhanced Routes
- `/routes/metrics.ts` - New metrics endpoint
- `/routes/management/usage.ts` - Time-series support
- `/routes/management/quotas.ts` - Quota API improvements

#### Database Schema Updates
- Added `tokensCacheWrite` to request usage
- Performance metrics improvements
- Migrations: 0008, 0009 (SQLite) / 0007, 0008 (PostgreSQL)

---

### 3. Quota Checkers (packages/backend/src/services/quota/)

#### New Checkers
- **MiniMax Quota Checker** - For MiniMax AI provider
- **OpenRouter Quota Checker** - For OpenRouter

#### Improved Checkers
- Claude Code - Enhanced OAuth handling
- OpenAI Codex - Better token tracking
- ZAI - Improved balance display
- Moonshot - Enhanced balance checking

---

### 4. Configuration Changes

#### Example Config (`config/plexus.example.yaml`)
- Added metrics configuration examples
- Enhanced quota checker examples

#### Environment
- New: `METRICS_ENABLED` flag
- New: `METRICS_RETENTION_DAYS`

---

### 5. Bug Fixes

| Issue | File | Fix |
|-------|------|-----|
| PieChart import error | Sidebar.tsx | Changed to BarChart3 |
| UI flashing on load | index.html | Added auto-login script |
| Concurrent rendering | ProtectedRoute | Fixed auth state handling |

---

### 6. Upstream Changes (from mcowger/plexus)

#### Features Merged
- Debug trace downloads
- Token accounting improvements
- Claude Opus 4.6 support
- Dedicated `/ui/quotas` page

#### Commits Included
- `edf12d5` - Debug trace downloads
- `47e63ae` - Token counting fixes
- `2a1ecd0` - Usage token semantics
- `99f453a` - Claude Opus 4.6
- `49bc5c6` - Codex/Code quota checkers

---

## Files Modified (110 total)

### Created (40+)
- Metrics route files (13 files)
- MiniMax/OpenRouter quota components (4 files)
- Database migrations (8 files)
- Skills documentation (.agents/skills/*)

### Modified (60+)
- Sidebar.tsx - Dashboard navigation
- App.tsx - New routes
- api.ts - Enhanced API
- usage-storage.ts - Performance improvements
- Dispatcher, Router services

---

## Deployment Notes

### Docker Image
```bash
# Build locally
cd ~/plexus-repo
sudo podman build -t thearchitectit-plexus:latest .

# Run
sudo podman run -d --name plexus -p 4001:4000 \
  -v $(pwd)/plexus.yaml:/app/config/plexus.yaml \
  localhost/thearchitectit-plexus:latest
```

### AI01 Access
- **URL:** http://100.96.49.42:4001
- **Admin:** http://100.96.49.42:4001/admin

---

## Breaking Changes

None. This merge maintains backward compatibility.

---

## Next Steps

1. Monitor metrics performance under load
2. Consider adding more provider quota checkers
3. Evaluate metrics retention policies
4. Document new API endpoints

---

## Contributors

- TheArchitectit (fork maintainer)
- mcowger (upstream)

---

*Generated: 2026-02-16*
