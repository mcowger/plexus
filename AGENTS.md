# Plexus System Context & Agent Guidelines

## 1. 🚨 CRITICAL OPERATIONAL MANDATES 🚨
> **These rules are non-negotiable and must be followed by all agents and LLMs working on this codebase.**

### 1.1 Documentation & Search Strategy
*   **NEVER** default to searching type definition files (`.d.ts`) to understand libraries.
*   **ALWAYS** use `tavily_search` or `google_web_search` to find official documentation and examples.
*   **REASON:** Type definitions often lack context and usage nuances.

### 1.2 Development Standards
*   **Type Safety:** `bun run typecheck` MUST pass before finalizing any changes.
*   **No 'Any':** Strictly avoid `any`. Use `unknown` with narrowing or proper interfaces.
*   **Library Constraints:**
    *   **Runtime:** Native Bun APIs are preferred over Node.js polyfills (e.g., file I/O).
    *   **Transformations:** NEVER build custom transformations. Use the existing architecture in `src/transformers` (derived from `@musistudio/llms`).
    *   **Types:** Do not duplicate types. Check `src/types` and `src/transformers/types.ts` first.
*   **Image/Asset Imports:**
    *   **Frontend:** Import images directly from the `@/assets/` path alias. Bun bundler handles the import and provides the resolved path.
    *   **Example:**
        ```typescript
        import plexusLogo from '@/assets/plexus_logo_transparent.png';
        // usage: <img src={plexusLogo} alt="Logo" />
        ```
    *   **Note:** Do NOT use Vite-specific syntax. This is a Bun project.

### 1.3 Build & Compilation
*   **Executable Compilation:** ALWAYS use `compile.ts` script to build executables, NEVER use `bun build --compile` directly.
    *   **REASON:** The CLI `bun build --compile` does NOT support bundler plugins. Only the JavaScript API (`Bun.build()`) supports plugins.
    *   **CRITICAL:** The `bun-plugin-tailwind` plugin is required for Tailwind CSS to work in compiled executables. Without it, CSS will not be generated.
    *   **bunfig.toml plugins:** The `[serve.static]` plugins in `bunfig.toml` only apply to the dev server, NOT production builds.
    *   **Usage:**
        ```bash
        # Use package.json scripts (recommended)
        bun run compile:macos
        bun run compile:linux
        bun run compile:all
        
        # Or call compile.ts directly
        bun compile.ts --target bun-darwin-arm64 --outfile dist/my-app
        ```
    *   **DO NOT:**
        ```bash
        # ❌ WRONG - plugins will NOT be included
        bun build index.ts --compile --target bun-darwin-arm64 --outfile dist/app
        ```

---

## 2. Project Overview

### 2.1 Identity
**Plexus** is a high-performance, unified API gateway and virtualization layer for Large Language Models (LLMs). It allows switching between providers (OpenAI, Anthropic, Gemini) without changing client code.

### 2.2 Core Objectives
1.  **Unified Surface:** Provide a single entry point for various LLM APIs.
    *   `/v1/chat/completions` (OpenAI style)
    *   `/v1/messages` (Anthropic style)
2.  **Virtualization:** Decouple "requested model" from "actual provider".
3.  **Control:** Centralized logging, load balancing, and configuration.

### 2.3 Target Audience
*   **AI Engineers:** Needing provider flexibility.
*   **Platform Architects:** Managing LLM traffic and costs.

---

## 3. Architecture & Data Flow

### 3.1 Tech Stack
*   **Runtime:** [Bun](https://bun.sh)
*   **Server:** Native Bun Webserver (`Bun.serve`)
*   **Language:** TypeScript
*   **Config:** YAML/JSON via Zod

### 3.2 Request Lifecycle (Transformation Workflow)
1.  **Ingest:** Client sends request (e.g., OpenAI format) to Plexus.
2.  **Route:** `Dispatcher` selects provider based on `config/plexus.yaml` rules (load balancing, aliasing).
3.  **Normalize:** `Transformer` converts request to `UnifiedChatRequest`.
4.  **Adapt:** `Transformer` converts `UnifiedChatRequest` to Provider's native format (e.g., Anthropic).
5.  **Execute:** HTTP call to Provider.
6.  **Denormalize:** Response is converted back to `UnifiedChatResponse`, then to the Client's expected format.

### 3.3 Directory Map
*   **`config/`**: System configuration.
*   **`packages/backend/src/`**:
    *   `index.ts`: Entry point.
    *   `server.ts`: HTTP server setup.
    *   `services/`: Business logic (`Dispatcher`, `Router`).
    *   `transformers/`: Provider adapters (OpenAI, Anthropic, Gemini).
    *   `types/`: Shared TypeScript definitions.
    *   `utils/`: Helpers (`logger`, `usage`).

---

## 4. Implementation Details

### 4.1 Unified API Surface
*   **POST** `/v1/chat/completions`: OpenAI compatibility.
*   **POST** `/v1/messages`: Anthropic compatibility.
*   **GET** `/v1/models`: Available models list.

### 4.2 Shared Utilities
**Usage Normalization (`src/utils/usage.ts`)**:
*   **MUST** be used for token metrics.
*   Handles difference between `prompt_tokens` (OpenAI) vs `input_tokens` (Anthropic).
*   Example:
    ```typescript
    import { normalizeUsage } from "../utils/usage";
    const usage = normalizeUsage(rawUsage);
    ```

---

## 5. Development & Testing

### 5.1 Environment
*   **Start Dev:** `bun run dev` (Watches `packages/backend`).
*   **Run Tests:** `bun test`.

### 5.2 Testing Guidelines (Strict Isolation)
*   **Global Mocks:** Do NOT use `mock.module` for global config in individual tests. It pollutes state.
*   **Setup:** Use `setup.ts` for common mocks (Logger).
*   **Spying:** Prefer `spyOn` over re-mocking.

    ```typescript
    // ✅ CORRECT
    import { logger } from "src/utils/logger";
    import { spyOn, expect, test } from "bun:test";

    test("logger usage", () => {
        const spy = spyOn(logger, "info");
        // ... action ...
        expect(spy).toHaveBeenCalled();
    });
    ```