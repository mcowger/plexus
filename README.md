# Plexus 2

Plexus 2 is a high-performance, universal LLM API gateway and transformation layer. It allows you to interact with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) using a single, unified API format, while also supporting provider-specific "passthrough" modes.

## Features

- **Unified API**: Support for both OpenAI-compatible and Anthropic-compatible endpoints.
- **Protocol Transformation**: Transparently convert requests and responses between different provider formats (e.g., send an OpenAI request to Anthropic Claude).
- **Streaming Support**: Full streaming support with real-time transformation of event streams.
- **Model Aliasing**: Define friendly model names that route to specific provider/model combinations.
- **Load Balancing**: Distribute requests across multiple backends for the same model alias.
- **Reasoning Support**: Unified handling of reasoning/thinking content from modern models.

## API Documentation

For detailed information on the available API endpoints, including the Standard Inference APIs and the Management APIs, please refer to [API.md](API.md).

## Installation

Plexus 2 is built with [Bun](https://bun.sh/).

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-repo/plexus2.git
   cd plexus2
   ```

2. **Install dependencies**:
   ```bash
   bun run install:all
   ```

## Usage

### Starting the Server

To start the gateway in development mode:
```bash
bun run dev
```
The server will start on port `3000` by default.

### Making Requests

You can use the provided test script to verify your setup:
```bash
bun testcommands/test_request.ts <model_alias> <json_file>
```

Example OpenAI-compatible request:
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d 
    "model": "minimax-m2.1",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  
```

## Configuration (plexus.yaml)

Plexus is configured via a `config/plexus.yaml` file. This file defines your providers and model routing logic.

### Example Configuration

```yaml
providers:
  # Define your upstream providers
  openai_direct:
    type: OpenAI
    api_base_url: https://api.openai.com/v1
    api_key: your_openai_key
    models:
      - gpt-4o
      - gpt-4o-mini

  my_anthropic:
    type: Anthropic
    api_base_url: https://api.anthropic.com/v1
    api_key: your_anthropic_key
    models:
      - claude-3-5-sonnet-latest

models:
  # Define aliases and where they route
  fast-model:
    targets:
      - provider: openai_direct
        model: gpt-4o-mini
  
  smart-model:
    targets:
      - provider: my_anthropic
        model: claude-3-5-sonnet-latest
```

### Configuration Sections

- **`providers`**:
    - `type`: The transformer type to use (`OpenAI`, `Anthropic`, etc.).
    - `api_base_url`: The root URL for the provider's API.
    - `api_key`: Your authentication token.
    - `models`: A list of raw model names available from this provider.
    - `headers`: (Optional) Extra headers to send with every request to this provider.

- **`models`**:
    - Each key is a "Model Alias" that clients will use in their `model` field.
    - `targets`: A list of provider/model pairs. If multiple targets are provided, Plexus will load-balance between them.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
