<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Plexus: one API surface for every LLM provider, with routes from OpenAI, Anthropic, and Gemini requests to model targets.">
</p>

<p align="center">
  <a href="https://discord.com/channels/292942011261124608/1503831216095367239">Discord</a> ·
  <a href="docs/openapi/openapi.yaml">API reference</a> ·
  <a href="docs/CONFIGURATION.md">Configuration</a> ·
  <a href="docs/INSTALLATION.md">Installation</a> ·
  <a href="docs/TESTING.md">Testing</a>
</p>

Plexus sits in front of your LLM providers so clients can use one consistent API while you choose how requests are translated, routed, observed, and recovered. It supports OpenAI, Anthropic, Gemini, OpenAI-compatible providers, OAuth-backed subscriptions, and streamable HTTP MCP servers.

## Why Plexus

- **Keep client code stable.** Accept OpenAI Chat Completions and Responses, Anthropic Messages, Gemini native requests, embeddings, audio, images, streaming, and tool use.
- **Route on your terms.** Map aliases to one or more targets with `random`, `in_order`, `cost`, `performance`, `latency`, or `e2e_performance` selection.
- **Operate with evidence.** Inspect request logs, tokens, cost, latency, live throughput, provider health, and per-key quotas from the dashboard.
- **Stay resilient.** Apply exponential cooldowns, fail over failed providers, detect stalled streams, and use vision fallthrough for non-vision targets.

<p align="center">
  <img src="./assets/readme/request-path.svg" width="100%" alt="A request through Plexus: your client, one normalized API surface, policy-aware routing, and an observable response.">
</p>

## Quick start

`ADMIN_KEY` is required for the dashboard and management API. `DATABASE_URL` is optional and defaults to SQLite at `./data/plexus.db`; use a PostgreSQL connection string for production.

### Run with Docker

```bash
docker run -p 4000:4000 \
  -v plexus-data:/app/data \
  -e ADMIN_KEY="your-admin-password" \
  -e ENCRYPTION_KEY="your-generated-hex-key" \
  ghcr.io/mcowger/plexus:latest
```

### Or use a standalone binary

Download a pre-built binary from [GitHub Releases](https://github.com/mcowger/plexus/releases/latest):

```bash
# macOS Apple Silicon
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-macos -o plexus
chmod +x plexus
ADMIN_KEY="your-admin-password" ./plexus

# Linux x64
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-linux -o plexus
chmod +x plexus
ADMIN_KEY="your-admin-password" ./plexus
```

```powershell
# Windows x64
Invoke-WebRequest -Uri "https://github.com/mcowger/plexus/releases/latest/download/plexus.exe" -OutFile "plexus.exe"
$env:ADMIN_KEY = "your-admin-password"
$env:DATABASE_URL = "sqlite://./data/plexus.db"
.\plexus.exe
```

The binary is self-contained; database migrations and the web dashboard are embedded. See [Installation](docs/INSTALLATION.md) for Docker Compose, Windows troubleshooting, source builds, and environment variables.

### Send a request

Open the dashboard at `http://localhost:4000`, then create/configure an API key and model alias. Send a request:

```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-plexus-my-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

OAuth providers are configured in the Admin UI. See [Configuration: OAuth providers](docs/CONFIGURATION.md#oauth-providers-pi-ai).

## See the control plane

The dashboard is the operating view: configure providers and aliases, investigate every request, and watch usage and quota health.

| Dashboard | Providers |
| --- | --- |
| ![Dashboard showing request volume, tokens, cost, and recent activity](docs/images/dashhome.png) | ![Providers view showing provider status, quota indicators, and controls](docs/images/providers.png) |
| Request logs | Model aliases |
| ![Request logs with model, provider, tokens, cost, latency, and live throughput](docs/images/logs.png) | ![Model aliases with targets, selectors, and routing priorities](docs/images/models.png) |

## Built for the edges of provider APIs

**Protocol translation** handles OpenAI, Anthropic, Gemini, and compatible formats in both directions, including streaming and tool use. **MCP proxying** isolates sessions for streamable HTTP MCP servers. **Encryption at rest** protects API keys, OAuth tokens, provider secrets, and MCP headers with AES-256-GCM when `ENCRYPTION_KEY` is set. See [Configuration](docs/CONFIGURATION.md) for the full operating model.

---

## Admin CLI

Pass a subcommand as the first argument to the binary or `bun run src/index.ts`:

- `rekey` decrypts sensitive fields with the current `ENCRYPTION_KEY` and re-encrypts them with `NEW_ENCRYPTION_KEY`.

```bash
ENCRYPTION_KEY="<current-key>" NEW_ENCRYPTION_KEY="<new-key>" ./plexus rekey
```

---

## Development

```bash
bun run setup:hooks
bun run test
```

`bun test` is intentionally blocked; use `bun run test`. See [Testing](docs/TESTING.md).

---

## License

MIT License — see [LICENSE](LICENSE).
