## 1. Executive Summary
**Plexus** is a high-performance, unified API gateway and virtualization layer for Large Language Models (LLMs). Built on the **Bun** runtime and **Hono** framework, it abstracts the complexity of integrating with multiple AI providers (OpenAI, Anthropic, Google, etc.) by transforming incoming APIs (`/v1/messages`, `/v1/chat/completions`, etc.). This enables developers to switch providers, load-balance requests, and manage model configurations without altering their client application code.

## 2. Target Audience
- **AI Engineers & Developers:** Building applications that consume LLM APIs and require flexibility in provider selection.
- **Platform Architects:** Seeking to unify LLM traffic through a centralized, controllable gateway.

## Goal
The core objective is to provide a single entry point for various LLM APIs:

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
- **Planned Endpoints:**
  - `POST /v1/responses`: OpenAI Responses API style.
  - `GET /v1/models`: List available models and aliases.

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
- **Web Framework:** [Hono](https://hono.dev/)
- **Configuration:** YAML (via `yaml` package)
- **Validation:** [Zod](https://zod.dev/)
- **Libraries:** Where possible, use native Bun libraries

### 4.2 System Components
- **`packages/backend`**: The core Hono server. Contains the dispatcher, router, and transformer logic.
- **`packages/frontend`**: React-based dashboard (work in progress).
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
- **Full Stack Dev:** Run `bun run scripts/dev.ts` from the root to start both the Backend (port 4000, watch mode) and Frontend Builder (watch mode).
- **Backend Only:** Run `bun run dev:backend` (port 4000 default).
- **Verification:** Use the scripts in `testcommands/test_request.ts` against `http://localhost:4000`.

### 6.1 Testing Guidelines
When writing tests for the backend, especially those involving configuration (`packages/backend/src/config.ts`), strict adherence to isolation principles is required to prevent "mock pollution" across tests.

**Do NOT use `mock.module` to mock the configuration module globally.** 
Bun's test runner can share state between test files, and hard-mocking the config module will cause other tests (like `pricing_config.test.ts` or `dispatcher.test.ts`) to fail unpredictably because they receive the mocked configuration instead of the real logic.

**Preferred Approaches:**

1.  **Unit Tests (Internal State):**
    Use the `setConfigForTesting` helper exported from `config.ts` to inject a specific configuration state for the duration of a test.
    ```typescript
    import { setConfigForTesting } from "../../config";
    
    test("my route test", () => {
        setConfigForTesting(myMockConfig);
        // ... assertions ...
    });
    ```

2.  **Integration Tests (Full Stack):**
    For tests that load the entire application (e.g., importing `index.ts`), use a **temporary configuration file**.
    - Create a temp file (e.g., `plexus-test-auth-123.yaml`).
    - Set `process.env.CONFIG_FILE` to this path *before* importing the app.
    - Explicitly call `loadConfig(path)` if necessary to ensure the state is refreshed.
    - Clean up (delete the file and unset the env var) in `afterAll`.

    ```typescript
    // Example Setup
    const TEMP_CONFIG_PATH = join(tmpdir(), `plexus-test-${Date.now()}.yaml`);
    writeFileSync(TEMP_CONFIG_PATH, mockYamlContent);
    process.env.CONFIG_FILE = TEMP_CONFIG_PATH;
    
    // ... run tests ...
    
    afterAll(() => {
        unlinkSync(TEMP_CONFIG_PATH);
        delete process.env.CONFIG_FILE;
    });
    ```