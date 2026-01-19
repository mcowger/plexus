# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) under a single API. Switch models and providers without rewriting client code.

## Key Features

- **Unified API**: OpenAI, Anthropic, and Gemini endpoints with intelligent protocol transformation
- **Smart Routing**: Model aliasing, load balancing (random, cost, performance, latency), automatic cooldown
- **Observability**: Real-time TTFT, TPS, costs, error rates, and debug mode
- **Security**: API key authentication, OAuth 2.0, multi-key rotation, admin protection

## Quick Start

```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest
```

See [Installation Guide](docs/INSTALLATION.md) for other options.

## License

MIT License - see LICENSE file.
