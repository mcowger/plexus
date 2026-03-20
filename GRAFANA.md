# Grafana / Prometheus Integration Guide

This document explains how to scrape Plexus metrics with Prometheus and recreate
every dashboard card from `/ui`, `/ui?tab=usage`, and `/ui?tab=performance` in
Grafana using PromQL.

---

## Prometheus Scrape Configuration

The metrics endpoint lives at:

```
GET /v0/management/metrics
```

It is protected by the same `X-Admin-Key` header used by all other management
routes, and returns Prometheus text-exposition format 0.0.4.

Add the following job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'plexus'
    scrape_interval: 15s          # adjust to taste; 10–30s is typical
    metrics_path: /v0/management/metrics
    static_configs:
      - targets:
          - 'your-plexus-host:3001'   # replace with your actual host:port
    authorization:
      type: ''                        # no Bearer prefix; we use a raw header
    params: {}
    # Prometheus does not natively support arbitrary request headers in scrape
    # configs prior to v2.26. Use the http_headers option (v2.26+):
    http_headers:
      X-Admin-Key:
        values:
          - 'your-admin-key-here'     # replace with your ADMIN_KEY env value
```

> **Note:** If your Prometheus version is older than 2.26, you can proxy the
> scrape through a metrics gateway or use the Prometheus `params` trick with a
> reverse proxy that injects the header.

---

## Complete Metric Reference

| Metric name | Type | Labels | Description |
|---|---|---|---|
| `plexus_requests_total` | counter | — | All-time requests |
| `plexus_errors_total` | counter | — | All-time non-success responses |
| `plexus_tokens_total` | counter | `type` | All-time tokens (input/output/cached/cache_write) |
| `plexus_energy_kwh_total` | counter | — | All-time estimated energy in kWh |
| `plexus_requests_today` | gauge | — | Requests since local midnight |
| `plexus_errors_today` | gauge | — | Errors since local midnight |
| `plexus_cost_today_usd` | gauge | — | Cost (USD) since local midnight |
| `plexus_tokens_today` | gauge | `type` | Tokens since local midnight (input/output/reasoning/cached/cache_write) |
| `plexus_energy_kwh_today` | gauge | — | Energy (kWh) since local midnight |
| `plexus_provider_requests_total` | counter | `provider` | All-time requests per provider |
| `plexus_provider_errors_total` | counter | `provider` | All-time errors per provider |
| `plexus_provider_tokens_total` | counter | `provider` | All-time total tokens per provider |
| `plexus_provider_cost_usd_total` | counter | `provider` | All-time cost per provider |
| `plexus_provider_avg_latency_ms` | gauge | `provider` | All-time avg end-to-end latency per provider |
| `plexus_provider_avg_ttft_ms` | gauge | `provider` | All-time avg time-to-first-token per provider |
| `plexus_provider_avg_tokens_per_sec` | gauge | `provider` | All-time avg throughput per provider |
| `plexus_model_alias_requests_total` | counter | `model_alias` | All-time requests per model alias |
| `plexus_model_alias_tokens_total` | counter | `model_alias` | All-time tokens per model alias |
| `plexus_api_key_requests_total` | counter | `api_key` | All-time requests per API key |
| `plexus_api_key_tokens_total` | counter | `api_key` | All-time tokens per API key |
| `plexus_in_flight_requests` | gauge | `provider` | Currently in-flight requests per provider |
| `plexus_in_flight_requests_by_model` | gauge | `model` | Currently in-flight requests per model |
| `plexus_cooldown_active` | gauge | `provider`, `model` | 1 if pair is in cooldown |
| `plexus_cooldown_time_remaining_ms` | gauge | `provider`, `model` | Ms remaining in cooldown |
| `plexus_cooldown_consecutive_failures` | gauge | `provider`, `model` | Consecutive failures that triggered cooldown |
| `plexus_perf_avg_ttft_ms` | gauge | `provider`, `model` | Avg TTFT from performance table |
| `plexus_perf_min_ttft_ms` | gauge | `provider`, `model` | Min TTFT from performance table |
| `plexus_perf_max_ttft_ms` | gauge | `provider`, `model` | Max TTFT from performance table |
| `plexus_perf_avg_tokens_per_sec` | gauge | `provider`, `model` | Avg throughput from performance table |
| `plexus_perf_min_tokens_per_sec` | gauge | `provider`, `model` | Min throughput from performance table |
| `plexus_perf_max_tokens_per_sec` | gauge | `provider`, `model` | Max throughput from performance table |
| `plexus_perf_sample_count` | gauge | `provider`, `model` | Sample count in performance aggregate |
| `plexus_perf_success_count` | gauge | `provider`, `model` | Success count in performance aggregate |
| `plexus_perf_failure_count` | gauge | `provider`, `model` | Failure count in performance aggregate |

---

## Recreating Dashboard Cards in Grafana

### `/ui` — Live Metrics tab

#### Metrics card — "Overview" column

| UI field | PromQL |
|---|---|
| Total Requests (all-time) | `plexus_requests_total` |
| Total Tokens (all-time) | `sum(plexus_tokens_total)` |

Use a **Stat** panel, no time range needed (the values are monotonically increasing counters).

#### Metrics card — "Today" column

| UI field | PromQL |
|---|---|
| Requests Today | `plexus_requests_today` |
| Cost Today | `plexus_cost_today_usd` |

Use a **Stat** panel. The gauge resets to 0 at local midnight on the server.

#### Metrics card — "Live window" column

The UI computes these from a rolling window of recent log records. In Prometheus,
use the `rate()` / `increase()` functions over the scrape interval:

| UI field | PromQL |
|---|---|
| Requests in window | `increase(plexus_requests_total[5m])` |
| Success Rate | `1 - rate(plexus_errors_total[5m]) / rate(plexus_requests_total[5m])` |
| Avg Latency | `plexus_provider_avg_latency_ms` (label filter as needed) |
| Tokens / Min | `rate(sum(plexus_tokens_total)[1m])` × 60 |

> Adjust the range vector `[5m]` to match your preferred live window.

#### Alerts & Providers card — cooldowns

| UI field | PromQL |
|---|---|
| Active cooldowns count | `count(plexus_cooldown_active == 1)` |
| Which pairs are in cooldown | `plexus_cooldown_active == 1` |
| Time remaining | `plexus_cooldown_time_remaining_ms` |
| Consecutive failures | `plexus_cooldown_consecutive_failures` |

Recommended: **Table** panel with `plexus_cooldown_active` + `plexus_cooldown_consecutive_failures` + `plexus_cooldown_time_remaining_ms`, joined on `provider` + `model` labels. Add an **Alert rule** on `count(plexus_cooldown_active) > 0`.

#### Provider Pulse card — top providers by request count

```promql
topk(8, increase(plexus_provider_requests_total[5m]))
```

Use a **Bar chart** panel with `provider` as the series label. Adjust `[5m]` to match your live window.

#### Model Pulse card — top models by request count

```promql
topk(8, increase(plexus_model_alias_requests_total[5m]))
```

Use a **Bar chart** panel with `model_alias` as the series label.

#### Concurrency card — in-flight requests per provider

```promql
plexus_in_flight_requests
```

Use a **Time series** panel. Because this is a gauge, Prometheus records the
point-in-time value at each scrape. Stack multiple series by `provider` label
to reproduce the stacked area chart from the UI.

#### Provider & Model Stats card

| UI column | PromQL |
|---|---|
| Requests | `plexus_provider_requests_total` |
| Errors | `plexus_provider_errors_total` |
| Success % | `1 - (plexus_provider_errors_total / plexus_provider_requests_total)` |
| Avg Latency | `plexus_provider_avg_latency_ms` |
| Avg TTFT | `plexus_provider_avg_ttft_ms` |
| Avg TPS | `plexus_provider_avg_tokens_per_sec` |
| Cost | `plexus_provider_cost_usd_total` |

Use a **Table** panel. Add transformations to merge metrics on the `provider` label.

---

### `/ui?tab=usage` — Usage Analytics tab

#### Requests over Time (time-series area chart)

```promql
rate(plexus_requests_total[1h])
```

Use a **Time series** panel. Adjust the range vector to match the time bucket
size you want (e.g. `[1h]` for hourly, `[1d]` for daily buckets). Use
`increase()` instead of `rate()` to get counts per bucket instead of per second.

#### Token Usage (time-series area chart, 5 series)

```promql
rate(plexus_tokens_total{type="input"}[1h])
rate(plexus_tokens_total{type="output"}[1h])
rate(plexus_tokens_total{type="cached"}[1h])
rate(plexus_tokens_total{type="cache_write"}[1h])
sum(rate(plexus_tokens_total[1h]))  # total
```

Use a **Time series** panel, one query per series.

#### Concurrency by Provider (stacked area chart)

```promql
plexus_in_flight_requests
```

Use a **Time series** panel, stacked, split by the `provider` label.

#### Concurrency by Model (stacked bar chart)

```promql
topk(8, plexus_in_flight_requests_by_model)
```

Use a **Time series** panel (stacked bars mode), split by `model` label.

#### Usage by Model Alias — Requests (pie chart)

```promql
plexus_model_alias_requests_total
```

Use a **Pie chart** panel split by `model_alias`.

#### Usage by Model Alias — Tokens (pie chart)

```promql
plexus_model_alias_tokens_total
```

#### Usage by Provider — Requests (pie chart)

```promql
plexus_provider_requests_total
```

Use a **Pie chart** panel split by `provider`.

#### Usage by Provider — Tokens (pie chart)

```promql
plexus_provider_tokens_total
```

#### Usage by API Key — Requests (pie chart)

```promql
plexus_api_key_requests_total
```

Use a **Pie chart** panel split by `api_key`.

#### Usage by API Key — Tokens (pie chart)

```promql
plexus_api_key_tokens_total
```

---

### `/ui?tab=performance` — Performance tab

The performance tab shows aggregated statistics from the `provider_performance`
table. These are **all-time** aggregates (not windowed), so they are represented
as Prometheus gauges and do not need `rate()`.

#### Fastest Providers (tok/s) bar chart

```promql
topk(8, plexus_perf_avg_tokens_per_sec)
```

Use a **Bar gauge** or **Bar chart** panel, sorted descending, split by
`provider` + `model` labels. In the legend/label display, use
`{{provider}}/{{model}}` as the label format to match the UI.

#### Fastest First Token (TTFT) bar chart

```promql
bottomk(8, plexus_perf_avg_ttft_ms > 0)
```

Use a **Bar gauge** panel sorted ascending (lower is better). Label:
`{{provider}}/{{model}}`.

#### Selected Model summary card

Filter by a specific model using label matchers:

```promql
plexus_perf_avg_tokens_per_sec{model="gpt-4o"}
plexus_perf_avg_ttft_ms{model="gpt-4o"}
plexus_perf_sample_count{model="gpt-4o"}
plexus_perf_success_count{model="gpt-4o"}
plexus_perf_failure_count{model="gpt-4o"}
```

Use **Stat** panels or a **Table** panel. In Grafana you can create a dashboard
variable `$model` (type: Query, query: `label_values(plexus_perf_avg_tokens_per_sec, model)`)
to get the model-selector dropdown equivalent to the UI's `<select>`.

#### Min / Max TTFT and throughput

```promql
plexus_perf_min_ttft_ms{model="$model"}
plexus_perf_max_ttft_ms{model="$model"}
plexus_perf_min_tokens_per_sec{model="$model"}
plexus_perf_max_tokens_per_sec{model="$model"}
```

Use **Stat** panels arranged in a 2×2 grid next to the averages.

---

## Suggested Dashboard Variables

| Variable | Query | Use |
|---|---|---|
| `$provider` | `label_values(plexus_provider_requests_total, provider)` | Filter all panels to one provider |
| `$model` | `label_values(plexus_perf_avg_tokens_per_sec, model)` | Model selector for Performance tab panels |
| `$model_alias` | `label_values(plexus_model_alias_requests_total, model_alias)` | Filter usage panels by alias |
| `$api_key` | `label_values(plexus_api_key_requests_total, api_key)` | Filter usage panels by key |

---

## Recommended Alert Rules

```yaml
groups:
  - name: plexus
    rules:
      - alert: PlexusProviderInCooldown
        expr: count(plexus_cooldown_active == 1) > 0
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "{{ $value }} provider/model pair(s) in Plexus cooldown"

      - alert: PlexusHighErrorRate
        expr: >
          rate(plexus_errors_total[5m])
          / rate(plexus_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Plexus error rate above 5% (currently {{ $value | humanizePercentage }})"

      - alert: PlexusNoTraffic
        expr: rate(plexus_requests_total[10m]) == 0
        for: 10m
        labels:
          severity: info
        annotations:
          summary: "No Plexus traffic in the past 10 minutes"
```

---

## Notes on Counter Reset Behaviour

Prometheus counters reset to 0 when the Plexus process restarts (or the SQLite
database is recreated). `rate()` and `increase()` handle this automatically via
counter reset detection, so time-series panels will remain correct across
restarts. The `_today` gauges reset at local midnight on the server, which
appears as a sawtooth pattern in time-series panels — this is expected.
