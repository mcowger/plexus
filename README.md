# Plexus 2

Plexus is a high-performance, unified API gateway and virtualization layer for Large Language Models (LLMs). It provides a single entry point for various LLM API formats, enabling seamless provider switching, intelligent load balancing, and comprehensive request management without requiring changes to client applications.

## Key Features

- **Multi-Protocol Gateway**: Supports OpenAI Chat Completions, Anthropic Messages, and Google Gemini API formats.
- **Intelligent Routing**: Dynamic model aliasing with multiple target selection strategies:
    - `random`: Uniform or weighted distribution.
    - `in_order`: Sequential fallback.
    - `cost`: Prefer the cheapest provider.
    - `latency`: Prefer the fastest provider.
    - `performance`: Composite score of throughput, latency, and cost.
- **Resilience**: Automatic provider cooldowns on errors (429, 5xx, timeouts) with persistent state.
- **Observability**: Detailed usage logging, cost calculation, and performance metrics.
- **Management API**: RESTful endpoints for configuration, state control, and log inspection.
- **Real-time Events**: SSE stream for monitoring system events as they happen.
- **High Performance**: Built on Bun with a focus on low-latency streaming and pass-through optimizations.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0.0+)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd plexus2
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Configure the system:
   ```bash
   cp config/plexus.example.yaml config/plexus.yaml
   # Edit config/plexus.yaml with your providers and API keys
   ```

   *Optional*: You can specify a custom config path using the `--config` flag or `PLEXUS_CONFIG_PATH` environment variable:
   ```bash
   bun run dev --config /path/to/your/plexus.yaml
   # OR
   PLEXUS_CONFIG_PATH=/path/to/your/plexus.yaml bun run dev
   ```

4. Set your provider API keys in the environment:
   ```bash
   export OPENAI_API_KEY="sk-..."
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

### Running the Server

```bash
bun run dev
```

The server will start at `http://localhost:4000` (by default).

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md): Detailed explanation of all configuration options.
- [Usage Guide](USAGE.md): How to interact with the API endpoints.
- [Design Document](DESIGN.md): Architectural overview and core principles.

## License

MIT
