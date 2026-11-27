export interface StreamFailureSnapshot {
  error?: { code?: string; message?: string };
  /** OpenRouter's canonical category on `response.failed`; `error.code` is lossy there. */
  error_type?: string;
}

/**
 * `response.error.code` values (Responses `response.failed` / `error`) that indicate
 * provider health problems. Sources:
 * - OpenAI `ResponseErrorCode` enum (openai-openapi): `server_error`, `rate_limit_exceeded`
 * - OpenAI error-codes guide / Codex client: `server_is_overloaded`
 * - MartLLM docs (martllm.com/docs/errors): `no_available_provider`, `service_unavailable`,
 *   `rate_limited`
 * - Meta Model API docs (dev.meta.ai/docs/error-handling): `server_shutting_down`,
 *   `service_overloaded`, `backend_unavailable` (all documented retryable 503s)
 * Staging: martllm `no_available_provider` (HTTP 503, matching the mid-stream failure text).
 */
const PROVIDER_FAULT_STREAM_ERROR_CODES: Record<string, true> = {
  server_error: true,
  server_is_overloaded: true,
  rate_limit_exceeded: true,
  no_available_provider: true,
  service_unavailable: true,
  rate_limited: true,
  server_shutting_down: true,
  service_overloaded: true,
  backend_unavailable: true,
};

/**
 * OpenRouter `response.error_type` values documented as upstream provider faults
 * (openrouter.ai/docs/api_reference/errors-and-debugging, Typed Error Codes).
 * OpenRouter collapses auth, validation and provider failures into `error.code:
 * "server_error"` on Responses streams, so when `error_type` is present it alone decides.
 * `server` and `unmapped` are undocumented as provider vs caller and are excluded.
 */
const OPENROUTER_PROVIDER_FAULT_ERROR_TYPES: Record<string, true> = {
  provider_overloaded: true,
  provider_unavailable: true,
  timeout: true,
  rate_limit_exceeded: true,
};

export function isProviderFaultStreamFailure(snapshot: StreamFailureSnapshot | null): boolean {
  if (!snapshot) return false;
  const errorType = snapshot.error_type;
  if (errorType) return Object.hasOwn(OPENROUTER_PROVIDER_FAULT_ERROR_TYPES, errorType);
  const code = snapshot.error?.code;
  return !!code && Object.hasOwn(PROVIDER_FAULT_STREAM_ERROR_CODES, code);
}
