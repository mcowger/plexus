# Test Commands

Utilities for manually testing the Plexus gateway.

## test_request.ts

A helper script to send requests to the local running server using the unified test cases.

### Usage

```bash
bun test_request.ts <model_alias> <case_path>
```

- **model_alias**: The model ID defined in your `plexus.yaml` (e.g., `minimax-m2.1`, `claude-haiku`).
- **case_path**: The relative path to a test case in `packages/backend/src/services/__tests__/cases/`.

### Examples

**Test Chat API (OpenAI-style):**
```bash
bun test_request.ts minimax-m2.1 chat/basic
bun test_request.ts minimax-m2.1 chat/tools-stream
```

**Test Messages API (Anthropic-style):**
```bash
bun test_request.ts claude-haiku messages/basic
bun test_request.ts claude-haiku messages/basic-stream
```

### Features
- **Automatic Discovery**: Looks for files in the backend `cases/` directory automatically.
- **Smart Endpoints**: Automatically routes to `/v1/chat/completions` or `/v1/messages` based on whether the case path contains `messages/`.
- **Extension Optional**: You can omit `.json` from the filename for brevity.
- **Model Override**: Automatically replaces any `PLACEHOLDER_MODEL` in the JSON file with your specified model alias.