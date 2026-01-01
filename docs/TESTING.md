# Testing Guide

This project uses [Polly.js](https://netflix.github.io/pollyjs/) for robust E2E testing. It records and replays HTTP interactions with upstream LLM providers, ensuring tests are fast, reliable, and run without API keys.

## E2E VCR Tests

The E2E tests are split by API type:
- **Chat API**: `packages/backend/src/services/__tests__/e2e_vcr_chat.test.ts` (Cases: `cases/chat/`)
- **Messages API**: `packages/backend/src/services/__tests__/e2e_vcr_messages.test.ts` (Cases: `cases/messages/`)

### How it works:
1.  **Dynamic Discovery**: Each suite loads `.json` files from its respective directory in `cases/`.
2.  **Cassette Recording (Polly.js)**: 
    -   Requests to upstream providers are intercepted.
    -   In **Record Mode**, real API calls are made and saved to `__cassettes__/` as JSON files.
    -   In **Replay Mode**, the network is completely mocked using these saved JSON files.
3.  **Validation**: The test verifies that the `Dispatcher` logic correctly transforms the upstream data into a valid Unified response.

## Running Tests

### 1. Standard Run (Replay Mode)
Uses existing cassettes. No API keys or network access are required.

```bash
cd packages/backend
bun test
```
*Tip: You can also run this via the VS Code task `Bun: Backend Tests`.*

### 2. Record Mode (Live API)
To capture new network interactions for ALL tests:

```bash
# From project root
PLEXUS_TEST_API_KEY="your-openai-key" \
PLEXUS_TEST_ANTHROPIC_API_KEY="your-anthropic-key" \
bun run update-cassettes
```

*Note: The suite automatically scrubs sensitive headers and model names before saving to disk.*

### 3. Manual Testing (Dev Environment)

To test the full system manually (Frontend + Backend):

1.  Start the development stack:
    ```bash
    bun dev
    ```
2.  Open the Dashboard at `http://localhost:3000`.
3.  Send requests to the API proxy at `http://localhost:3000/v1/...` using `curl` or `testcommands/test_request.ts`.

## Configuration Overrides
The following environment variables are used during **Record Mode**:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PLEXUS_TEST_API_KEY` | OpenAI-compatible API Key. | `scrubbed_key` |
| `PLEXUS_TEST_ANTHROPIC_API_KEY` | Anthropic API Key. | `scrubbed_key` |
| `PLEXUS_TEST_BASE_URL` | Base URL for OpenAI provider. | `https://api.upstream.mock/openai/v1` |
| `PLEXUS_TEST_ANTHROPIC_BASE_URL` | Base URL for Anthropic provider. | `https://api.anthropic.com/v1` |

## Adding New Test Cases

1.  Add a new JSON request body to `cases/chat/` (for OpenAI-like) or `cases/messages/` (for Anthropic-like).
2.  Run the **Record Mode** command above to capture the network interaction.
3.  Commit the new case and its corresponding cassette in `__cassettes__/`.

