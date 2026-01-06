# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration Guide](docs/CONFIGURATION.md) | [📦 Installation Guide](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers—OpenAI, Anthropic, Gemini, and more—under a single, standard API. It handles protocol translation, load balancing, and observability, allowing you to switch models and providers without rewriting your client code.

![Dashboard Overview](docs/images/homepage.png)

## Core Features

- **Unified API**: Support for OpenAI-compatible (`/v1/chat/completions`), Anthropic-compatible (`/v1/messages`), and Gemini endpoints.
  - Tools like Gemini and ClaudeCode work flawlessly with full image support for Anthropic protocol.
- **Multi-Protocol Provider Support**: Providers can expose multiple API endpoints (e.g., both OpenAI and Anthropic formats). Configure which models are accessible via which protocols, and Plexus handles authentication and routing automatically.
- **Protocol Transformation**: Transparently convert requests and responses between different provider formats (e.g., send an OpenAI request to Anthropic Claude).
  - Powered by a robust state machine for reliable stream conversion, even under heavy load.
- **Streaming Support**: Full streaming support with real-time transformation of event streams, built on Fastify for maximum reliability and performance.
- **Model Aliasing**: Define friendly model names that route to specific provider/model combinations.
- **Intelligent Load Balancing**: Distribute requests across multiple backends for the same model alias using sophisticated selection strategies:
  - **Random**: (Default) Simple random distribution across healthy targets.
  - **Lowest Cost**: Automatically routes to the cheapest available target based on your pricing configuration.
  - **Highest Performance**: Routes based on real-time throughput (Tokens Per Second).
  - **Lowest Latency**: Routes based on Time to First Token (TTFT).
  - **Automatic Cooldown**: Temporarily removes providers from rotation if they encounter errors or rate limits.
- **API Priority Matching**: Configure routing to prioritize native API compatibility. When enabled (`priority: api_match`), Plexus filters providers by incoming API type before applying selection strategies, maximizing fidelity and compatibility at the cost of some routing flexibility.
- **Performance Tracking**: Continuous monitoring of upstream providers, tracking TTFT, TPS, and error rates to power intelligent routing.
- **Reasoning Support**: Unified handling of reasoning/thinking content from modern models, including Gemini `thoughtSignatures`.
- **API Key Authentication**: Secure your gateway with standard Bearer token authentication for all inference endpoints.
- **Cost Tracking & Management**: Comprehensive cost tracking with support for multiple pricing strategies:
  - **Simple**: Fixed per-token rates.
  - **OpenRouter**: Automatic fetching of real-time pricing.
  - **Tiered**: Advanced volume-based pricing tiers.
- **Pass-through Optimization**: Automatically detects when the incoming request format matches the target provider's native format, bypassing protocol conversion between different API formats to minimize latency and maximize compatibility while preserving usage tracking and observability. Active passthrough requests are highlighted with a ⚡ icon in the dashboard logs.
- **Adaptive API Matching**: For providers that support multiple protocols (e.g., both OpenAI and Anthropic formats), Plexus dynamically selects the best protocol for each model to minimize transformation overhead and improve reliability.
- **Deep Debugging**: Easy-to-use raw request and response capture, with detailed information of raw and transformed responses, as well as stream reconstruction.

## Performance Metrics & Observability

Plexus continuously monitors the health and performance of every upstream provider and model. It maintains a rolling window of recent metrics, which powers the intelligent routing engine and provides deep visibility into your LLM infrastructure.

- **Time to First Token (TTFT)**: Tracks responsiveness, crucial for interactive applications.
- **Tokens Per Second (TPS)**: Measures overall throughput for each model.
- **Real-time Cost Calculation**: Precise cost tracking for every request, visible in the dashboard.
- **Historical Analysis**: View performance trends and usage patterns over time.

## The Plexus Dashboard

Plexus comes with a comprehensive, real-time dashboard for managing your AI gateway.

### Observability & Debugging
Gain deep insights into your LLM traffic. View request logs, analyze detailed traces, and debug raw payloads.

| Request Logs | Deep Tracing |
|:---:|:---:|
| ![Request Logs](docs/images/request_logs.png) | ![Debug Traces](docs/images/debug_traces.png) |

Use **Debug Mode** to inspect the raw input and output of every transformation step.

![Debug Mode](docs/images/debug_mode.png)

### Configuration Management
Manage your entire Plexus configuration through the web interface with comprehensive UI coverage for all settings:
- **Provider Management**: Add, edit, and configure AI providers with support for multi-endpoint configurations
- **Model Aliases**: Create and manage model routing rules with load balancing strategies
- **API Keys**: Manage authentication keys for secure access
- **Routing Preferences**: Configure selection strategies (cost, latency, performance) and API priority matching

| Provider Management | Model Aliases |
|:---:|:---:|
| ![Providers](docs/images/providers.png) | ![Model Aliases](docs/images/model_aliases.png) |

**YAML Config Editor** for power users - all UI changes are written back to your `plexus.yaml` configuration file:
![Config Editor](docs/images/config_editor.png)

### Usage Analytics
Track your API usage and trends over time.

![Usage Overview](docs/images/usage_overview.png)

## Documentation

- **[Installation Guide](docs/INSTALLATION.md)**: Instructions for Docker, binary, and source installations.
- **[Configuration Guide](docs/CONFIGURATION.md)**: Learn how to set up `plexus.yaml` to define providers, models, and routing rules.
- **[API Documentation](docs/API.md)**: Detailed reference for the Standard Inference APIs and Management APIs.
- **[Troubleshooting Guide](TROUBLESHOOTING.md)**: Solutions for common issues, including API timeouts.

## Installation

The quickest way to get started is using Docker:

```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest
```

Please refer to the [Installation Guide](docs/INSTALLATION.md) for detailed instructions on other methods (standalone binary, or from source).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.