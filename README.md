# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration Guide](docs/CONFIGURATION.md) | [📦 Installation Guide](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers—OpenAI, Anthropic, Gemini, and more—under a single, standard API. It handles protocol translation, load balancing, and observability, allowing you to switch models and providers without rewriting your client code.

![Dashboard Overview](docs/images/homepage.png)

## Core Features

- **Unified API**: Support for both OpenAI-compatible, Anthropic-compatible and Gemini endpoints.
  - Tools like Gemini and ClaudeCode work flawlessly.
- **Protocol Transformation**: Transparently convert requests and responses between different provider formats (e.g., send an OpenAI request to Anthropic Claude).
- **Streaming Support**: Full streaming support with real-time transformation of event streams.
- **Model Aliasing**: Define friendly model names that route to specific provider/model combinations.
- **Load Balancing**: Distribute requests across multiple backends for the same model alias, with configurable selection & routing options.
  - Automatic Cooldown for providers experiencing issues.
- **Reasoning Support**: Unified handling of reasoning/thinking content from modern models, including Gemini `thoughtSignatures`.
- **API Key Authentication**: Secure your gateway with standard Bearer token authentication for all inference endpoints.
- **Cost Tracking & Management**: Comprehensive cost tracking with support for multiple pricing strategies:
  - **Simple**: Fixed per-token rates.
  - **OpenRouter**: Automatic fetching of real-time pricing.
  - **Tiered**: Advanced volume-based pricing tiers.
- **Pass-through Optimization**: Automatically detects when the incoming request format matches the target provider's native format, bypassing expensive transformations to minimize latency and overhead while maintaining full observability. Active passthrough requests are highlighted with a ⚡ icon in the dashboard logs.
- **Deep Debugging**: Easy-to-use raw request and response capture, with detailed information of raw and transformed responses, as well as stream reconstruction.

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
Manage your providers and model aliases directly from the UI or via the YAML configuration editor.

| Provider Management | Model Aliases |
|:---:|:---:|
| ![Providers](docs/images/providers.png) | ![Model Aliases](docs/images/model_aliases.png) |

**YAML Config Editor** for power users:
![Config Editor](docs/images/config_editor.png)

### Usage Analytics
Track your API usage and trends over time.

![Usage Overview](docs/images/usage_overview.png)

## Documentation

- **[Installation Guide](docs/INSTALLATION.md)**: Instructions for Docker, binary, and source installations.
- **[Configuration Guide](docs/CONFIGURATION.md)**: Learn how to set up `plexus.yaml` to define providers, models, and routing rules.
- **[API Documentation](docs/API.md)**: Detailed reference for the Standard Inference APIs and Management APIs.

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