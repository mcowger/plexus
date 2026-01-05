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

## Global Test Setup

To ensure test isolation and prevent "mock pollution" in Bun's shared-worker environment, this project uses a global setup script.

### `bunfig.toml` and `test/setup.ts`

The root `bunfig.toml` is configured to preload `packages/backend/test/setup.ts` before any tests run. This script establishes "Gold Standard" mocks for global dependencies like the **Logger**.

### Mocking Pattern: Shared Dependencies

Bun's `mock.module` is a process-global operation. Once a module is mocked, it remains mocked for the duration of that worker thread, and `mock.restore()` does **not** reset it.

To prevent crashes in other tests (e.g., `TypeError: logger.info is not a function`), follow these rules:

1.  **Use the Global Setup:** Common modules like `src/utils/logger` should be mocked once in `setup.ts`.
2.  **Robust Mocking:** If you must mock a module in a specific test file, your mock **MUST** implement the entire public interface of that module (including all log levels like `silly`, `debug`, etc.).
3.  **Prefer Spying:** If you need to assert that a global dependency was called, use `spyOn` on the already-mocked global instance rather than re-mocking the module.

```typescript
import { logger } from "src/utils/logger";
import { spyOn, expect, test } from "bun:test";

test("my test", () => {
    const infoSpy = spyOn(logger, "info");
    // ... run code ...
    expect(infoSpy).toHaveBeenCalled();
});
```

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
| `PLEXUS_TEST_API_KEY` | Chat-compatible API Key. | `scrubbed_key` |
| `PLEXUS_TEST_ANTHROPIC_API_KEY` | Messages API Key. | `scrubbed_key` |
| `PLEXUS_TEST_BASE_URL` | Base URL for Chat provider. | `https://api.upstream.mock/openai/v1` |
| `PLEXUS_TEST_ANTHROPIC_BASE_URL` | Base URL for Messages provider. | `https://api.anthropic.com/v1` |

## Adding New Test Cases

1.  Add a new JSON request body to `cases/chat/` (for Chat-like) or `cases/messages/` (for Messages-like).
2.  Run the **Record Mode** command above to capture the network interaction.
3.  Commit the new case and its corresponding cassette in `__cassettes__/`.

