# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) under a single API. Switch models and providers without rewriting client code.

### Recent Updates (v0.8.5)

- **Bulk Model Import**: Import models directly in provider configuration
- **Direct Model Routing**: Route directly to provider models with `direct/provider/model` format  
- **Per-Model Cooldowns**: Configure cooldown periods per target within model aliases
- **InOrder Selector**: Prioritized fallback logic with automatic health recovery

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
