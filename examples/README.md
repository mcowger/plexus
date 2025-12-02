# Configuration Examples

This directory contains sample configuration files for the Plexus LLM routing system.

## Files

- **providers.json**: Provider configurations for different LLM APIs
- **virtual-keys.json**: Virtual key configurations with routing rules
- **models.json**: Model specifications including pricing and capabilities

## Usage

1. Copy the example files to your backend's `config` directory:
   ```bash
   cp examples/*.json packages/backend/config/
   ```

2. Update the configuration files with your actual API keys and settings.

3. The configuration loader will automatically load these files on startup.

## Configuration Details

### providers.json

Defines the actual LLM provider connections. Each provider configuration includes:

- **type**: Provider type (`openai`, `anthropic`, or `openrouter`)
- **apiKey**: Your API key for the provider (replace with actual keys)
- **baseURL**: (Optional) Custom API endpoint
- **model**: (Optional) Default model to use
- **temperature**: (Optional) Default temperature setting (0-2)
- **maxTokens**: (Optional) Default maximum tokens (1-32000)

**Example:**
```json
{
  "openai-primary": {
    "type": "openai",
    "apiKey": "sk-proj-xxxxxxxxxxxx",
    "model": "gpt-4-turbo-preview",
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

### virtual-keys.json

Defines virtual keys for client access with routing and rate limiting. Each virtual key includes:

- **key**: The virtual API key string (generate secure random keys)
- **provider**: Primary provider to use
- **model**: Model to use with this key
- **priority**: Priority level (lower = higher priority)
- **fallbackProviders**: (Optional) Array of fallback providers
- **rateLimit**: (Optional) Rate limiting configuration
  - **requestsPerMinute**: Maximum requests per minute
  - **requestsPerHour**: Maximum requests per hour

**Example:**
```json
{
  "vk-production-gpt4": {
    "key": "vk-prod-xxxxxxxx",
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "priority": 1,
    "fallbackProviders": ["anthropic", "openrouter"],
    "rateLimit": {
      "requestsPerMinute": 60,
      "requestsPerHour": 1000
    }
  }
}
```

### models.json

Defines model specifications and pricing. Each model configuration includes:

- **name**: Model identifier
- **provider**: Provider offering this model
- **maxTokens**: (Optional) Maximum output tokens
- **supportsStreaming**: Whether streaming is supported (default: true)
- **contextWindow**: (Optional) Context window size in tokens
- **inputTokenPrice**: (Optional) Cost per 1K input tokens in USD
- **outputTokenPrice**: (Optional) Cost per 1K output tokens in USD

**Example:**
```json
{
  "gpt-4-turbo-preview": {
    "name": "gpt-4-turbo-preview",
    "provider": "openai",
    "maxTokens": 4096,
    "supportsStreaming": true,
    "contextWindow": 128000,
    "inputTokenPrice": 0.01,
    "outputTokenPrice": 0.03
  }
}
```

## Security Notes

⚠️ **Important**: The example files contain placeholder API keys. Always:

1. **Never commit real API keys** to version control
2. Use environment variables or secure secret management for production
3. Generate cryptographically secure random strings for virtual keys
4. Restrict file permissions on configuration files (chmod 600)
5. Add `config/*.json` to your `.gitignore` file

## Generating Secure Keys

For virtual keys, use a secure random generator:

```bash
# Generate a secure virtual key (Node.js)
node -e "console.log('vk-' + require('crypto').randomBytes(32).toString('hex'))"

# Or using OpenSSL
openssl rand -hex 32
```

## Testing Configuration

You can test your configuration by running:

```bash
cd packages/backend
pnpm test config-loader.test.ts
```

## Loading Configuration

The ConfigurationLoader will automatically load these files from the `config` directory. You can also specify a custom path:

```typescript
import { ConfigurationLoader } from './config/loader';

const loader = new ConfigurationLoader('/path/to/config');
await loader.loadConfiguration();
```

