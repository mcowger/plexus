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