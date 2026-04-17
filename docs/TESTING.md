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

Backend tests run on **Vitest**.

### `vitest.config.ts`, `test/vitest.global-setup.ts`, and `test/vitest.setup.ts`

- `packages/backend/vitest.config.ts` is the single backend test-runner config.
- `packages/backend/test/vitest.global-setup.ts` creates a temporary file-backed SQLite database, generates Drizzle metadata if needed, runs migrations once, and removes the temp directory after the run.
- `packages/backend/test/vitest.setup.ts` installs stable logger/debug test doubles for each worker.
- Root `bunfig.toml` intentionally blocks raw `bun test` at the repo root and points contributors to `cd packages/backend && bun run test`.
- `packages/backend/bunfig.toml` intentionally blocks raw `bun test` in `packages/backend` and points contributors to `bun run test`.

### Mocking Pattern: Shared Dependencies

Vitest restores mocks reliably, but shared dependencies should still follow these rules:

1. **Use the shared setup:** Common modules like `src/utils/logger` are mocked once in `vitest.setup.ts`.
2. **Robust Mocking:** If you mock a module in a specific test file, your mock **MUST** implement the relevant public interface of that module.
3. **Prefer Spying:** If you need to assert that a shared dependency was called, use `vi.spyOn` or `registerSpy` rather than replacing the whole module repeatedly.

```typescript
import { logger } from "src/utils/logger";
import { expect, test, vi } from "vitest";

test("my test", () => {
    const infoSpy = vi.spyOn(logger, "info");
    // ... run code ...
    expect(infoSpy).toHaveBeenCalled();
});
```

## Running Tests

### 1. Standard Run

From the repo root:

```bash
bun run test
```

Or from the backend package:

```bash
cd packages/backend
bun run test
```

> Note: `bun test` is intentionally blocked both at repo root and in `packages/backend`. Use `bun run test` instead.

### 2. Watch Mode

From the repo root:

```bash
bun run test:watch
```

Or from the backend package:

```bash
cd packages/backend
bun run test:watch
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
2.  Open the Dashboard at `http://localhost:4000`.
3.  Send requests to the API proxy at `http://localhost:4000/v1/...` using `curl` or `testcommands/test_request.ts`.

## Configuration Overrides
The following environment variables are used during **Record Mode**:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PLEXUS_TEST_API_KEY` | Chat-compatible API Key. | `scrubbed_key` |
| `PLEXUS_TEST_ANTHROPIC_API_KEY` | Messages API Key. | `scrubbed_key` |
| `PLEXUS_TEST_BASE_URL` | Base URL for Chat provider. | `https://api.upstream.mock/openai/v1` |
| `PLEXUS_TEST_ANTHROPIC_BASE_URL` | Base URL for Messages provider. | `https://api.anthropic.com/v1` |

