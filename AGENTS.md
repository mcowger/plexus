## 1. Executive Summary
**Plexus** is a high-performance, unified API gateway and virtualization layer for Large Language Models (LLMs). Built on the **Bun** runtime and **Fastify** framework, it abstracts the complexity of integrating with multiple AI providers (OpenAI, Anthropic, Google, etc.) by transforming incoming APIs (`/v1/messages`, `/v1/chat/completions`, etc.). This enables developers to switch providers, load-balance requests, and manage model configurations without altering their client application code.

## 2. Target Audience - **AI Engineers & Developers:** Building applications that consume LLM APIs and require flexibility in provider selection. - **Platform Architects:** 
Seeking to unify LLM traffic through a centralized, controllable gateway.


## CRITICAL REQUIREMENTS:   NEVER default to searching types definitions files for libraries.  ALWAYS rely on the tavily and context7 MCP tools to search the web for better documentation. FOLLOWING THIS REQUIREMENT IS CRITICAL.

## Goal The core objective is to provide a single entry point for various LLM APIs:

- `/v1/chat/completions` (OpenAI style)
- `/v1/messages` (Anthropic style)
- `/v1/responses` (OpenAI Responses style - Planned)

Plexus routes requests to any backend provider regardless of its native API format. For example, a request sent to the `/v1/chat/completions` endpoint can be routed to an Anthropic model, with Plexus handling the transformation of both the request and the response.

### Transformation Workflow:
1. **Receive Request:** Accept a request in a supported style (e.g., OpenAI chat completions).
2. **Select Provider:** Resolve the target provider and model based on the request's `model` field and the system configuration.
3. **Transform Request:** Convert the input payload into the internal `UnifiedChatRequest` format, then into the target provider's specific format (e.g., Anthropic messages).
4. **Execute Call:** Make the HTTP request to the target provider's endpoint with appropriate headers and authentication.
5. **Transform Response:** Convert the provider's response back into the original requesting style before returning it to the client.

## 3. Core Features & Capabilities

### 3.1 Unified API Surface
- **Implemented Endpoints:**
  - `POST /v1/chat/completions`: Standard OpenAI-compatible chat completion endpoint.
  - `POST /v1/messages`: Standard Anthropic-compatible messages endpoint.
  - `GET /v1/models`: List available models and aliases.

- **Planned Endpoints:**
  - `POST /v1/responses`: OpenAI Responses API style.

### 3.2 Advanced Routing & Virtualization
- **Model Aliasing:** Decouples requested model IDs from actual provider implementations.
- **Load Balancing:** Supports multiple targets for a single alias with randomized distribution.
- **Configuration-Driven:** Routing and provider settings are defined in `config/plexus.yaml`.

### 3.3 Multi-Provider Support
Uses a "Transformer" architecture in `packages/backend/src/transformers/`:
- **OpenAI:** Handles OpenAI, OpenRouter, DeepSeek, Groq, and other compatible APIs.
- **Anthropic:** Native support for Anthropic's messages format.
- **Streaming:** Full support for Server-Sent Events (SSE) across different formats.
- **Tool Use:** Normalizes tool calling/function calling.

## 4. Technical Architecture

### 4.1 Stack
- **Runtime:** [Bun](https://bun.sh)
- **Web Framework:** Fastify
- **Configuration:** YAML (via `yaml` package)
- **Validation:** [Zod](https://zod.dev/)
- **Libraries:** Where possible, use native Bun libraries

### 4.2 System Components
- **`packages/backend`**: The core Fastify server. Contains the dispatcher, router, and transformer logic.
- **`packages/frontend`**: React-based dashboard.
- **`llms/`**: A reference implementation (Fastify-based) containing extensive transformer logic for diverse providers (Vertex, Gemini, Cerebras, etc.) used to guide development in `packages/backend`.
- **`CAP-UI/`**: A reference implementation of a management UI and usage tracking tool used to guide development in `packages/frontend`.  Do not use it as a reference for backend code.   Primarily use it for UI techniques and layout.
- **`testcommands/`**: TypeScript-based CLI tools and JSON payloads for verifying transformations and streaming.

## 5. Directory Structure
- `config/`: Configuration files (`plexus.yaml`).
- `packages/backend/src/`:
  - `services/`: Core logic (`Dispatcher`, `Router`, `TransformerFactory`).
  - `transformers/`: Protocol translation logic.
  - `types/`: Unified types for requests, responses, and streaming chunks.
  - `utils/`: Shared utilities (Logger).

## 6. Development & Testing
- **Full Stack Dev:** Run `bun run dev` from the root to start both the Backend (port 4000, watch mode) and Frontend Builder (watch mode).

### 6.1 Testing Guidelines
When writing tests for the backend, especially those involving configuration (`packages/backend/src/config.ts`), strict adherence to isolation principles is required to prevent "mock pollution" across tests.

**Do NOT use `mock.module` to mock the configuration module globally.** 
Bun's test runner can share state between test files, and hard-mocking the config module will cause other tests (like `pricing_config.test.ts` or `dispatcher.test.ts`) to fail unpredictably because they receive the mocked configuration instead of the real logic.  


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

## 7. Frontend Styling & Tailwind CSS

### 7.1 Tailwind CSS Build Process
The frontend uses Tailwind CSS v4. To ensure utility classes are correctly scanned and generated, the following configurations are CRITICAL:

- **No CSS-in-JS Imports:** **NEVER** import `globals.css` (or any CSS file containing Tailwind v4 directives) directly into `.ts` or `.tsx` files. Bun's internal CSS loader does not support Tailwind v4 `@theme` or `@source` directives and will overwrite the valid CSS generated by the CLI with a broken version. The build script (`build.ts`) handles linking the generated `main.css` in the final `index.html`.
- **Build Command Execution:** The `@tailwindcss/cli` should be executed from the `packages/frontend` directory. The input path should be `./src/globals.css` and the output path should be `./dist/main.css`.
- **Source Directives:** In `packages/frontend/src/globals.css`, use `@source "../src/**/*.{tsx,ts,jsx,js}";`. This ensures the scanner looks at the source files relative to the CSS file's location.

Failure to follow these settings will result in a `main.css` file that contains only base styles and no generated utility classes, causing the UI to appear unstyled.

### 7.2 Static Assets Location
All static assets (images, logos, icons, etc.) must be placed in `packages/frontend/src/assets/`.

- **Import Assets in Components:** Import assets using ES6 import statements (e.g., `import logo from '../assets/logo.svg'`) rather than using direct paths.
- **Do NOT use dynamic paths:** Avoid using template strings or dynamic paths like `/images/${filename}.svg` as they won't work with the build process.
- **Move Existing Assets:** If you find assets in other locations (e.g., `packages/frontend/images/`), move them to `packages/frontend/src/assets/` and update any references to use imports.

This ensures assets are properly bundled by the build system and served correctly in both development and production environments.

### 7.3 Number and Time Formatting - **PREFERRED APPROACH**

The project uses centralized formatting utilities in `packages/frontend/src/lib/format.ts` powered by the [human-format](https://www.npmjs.com/package/human-format) library.

**ALWAYS use these utilities instead of creating custom formatting logic:**

- **`formatNumber(num, decimals?)`**: Large numbers with K/M/B suffixes (e.g., "1.3k", "2.5M")
- **`formatTokens(tokens)`**: Alias for `formatNumber` specifically for token counts
- **`formatDuration(seconds)`**: Human-readable durations with two most significant units (e.g., "2h 30m", "3mo 2w", "1y 2mo")
- **`formatTimeAgo(seconds)`**: Relative time format (e.g., "5m ago", "2h ago", "3d ago")
- **`formatCost(cost, maxDecimals?)`**: Dollar formatting with appropriate precision (e.g., "$0.001234", "$1.23")
- **`formatMs(ms)`**: Milliseconds to seconds conversion (e.g., "45ms", "2.5s", "∅")
- **`formatTPS(tps)`**: Tokens per second with one decimal place (e.g., "15.3")

**DO NOT:**
- Use `toFixed()` for number formatting
- Use `toLocaleString()` with custom fraction digits for numbers
- Create inline formatting logic with manual calculations
- Duplicate formatting code across components

**Example Usage:**

```typescript
import { formatCost, formatMs, formatTPS, formatDuration, formatTokens } from '../lib/format';

// Cost formatting
{formatCost(log.costTotal)}           // "$1.23"
{formatCost(log.costInput)}           // "$0.000456"

// Time formatting
{formatMs(log.durationMs)}            // "2.5s"
{formatMs(log.ttftMs)}                // "450ms"
{formatTPS(log.tokensPerSec)}         // "15.3"

// Duration formatting (tokens, cooldowns, etc.)
{formatDuration(account.expires_in_seconds)}     // "2h 30m"
{formatDuration(cooldownRemaining)}              // "45m"
{formatDuration(3600 * 24 * 365 + 2592000)}      // "1y 1mo"

// Token counts
{formatTokens(log.tokensInput)}       // "1.3k"
```

**Backend Integration:**

The `formatLargeNumber` function exported from `packages/frontend/src/lib/api.ts` is an alias to `formatNumber` for backward compatibility. Always import from `format.ts` for new code:

```typescript
// ✅ Preferred
import { formatNumber } from '../lib/format';

// ⚠️ Legacy (still works but avoid in new code)
import { formatLargeNumber } from '../lib/api';
```