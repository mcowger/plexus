# Plexus Inference V2 Beta Tester Note

The new Plexus inference path should be ready for beta testing.

This beta is focused on the new `inference-v2` path, where Plexus uses `@earendil-works/pi-ai` as the native transformation layer for chat-style inference requests. The goal is to replace more of Plexus's hand-written upstream request/response transformation code with pi-ai's provider-specific implementations while preserving Plexus routing, logs, debug visibility, quotas, cooldowns, and failover behavior.

## What Changed

Historically, Plexus handled inference requests through this pipeline:

```text
client wire format -> Plexus Transformer -> UnifiedChatRequest -> Dispatcher -> upstream HTTP request -> Transformer response parser -> client wire format
```

The new beta path uses pi-ai for the upstream transformation layer:

```text
client wire format -> inference-v2 parser -> pi-ai Context -> pi-ai stream/complete -> inference-v2 serializer -> client wire format
```

Plexus still owns the outer gateway responsibilities: API key auth, routing, model aliases, key access policy, quotas, cooldowns, failover, usage logs, debug logs, request IDs, and UI observability.

pi-ai owns the provider-native request construction and response parsing for supported chat-style APIs.

## How To Opt In

There are two ways a request can enter the beta path.

### Option 1: Use Explicit Beta Routes

These explicit beta routes always use `inference-v2`:

```text
POST /beta/v1/chat/completions
POST /beta/v1/messages
POST /beta/v1/responses
POST /beta/v1beta/models/{model}:generateContent
POST /beta/v1beta/models/{model}:streamGenerateContent
```

These are useful when you want a client or test harness to opt in by changing the base URL.

Gemini is different because the Gemini-compatible API already uses `/v1beta/...` as its normal stable path. The explicit Gemini beta route keeps the normal Gemini colon action form and adds the `/beta` prefix in front of it.

### Option 2: Enable Beta On An API Key

Admins can mark an API key as beta in Access Control.

When a key has the beta option enabled, requests sent to the normal stable paths are routed through `inference-v2` for supported APIs:

```text
POST /v1/chat/completions
POST /v1/messages
POST /v1/responses
POST /v1beta/models/{model}:generateContent
POST /v1beta/models/{model}:streamGenerateContent
```

This is the easiest way to let a beta tester use their normal client configuration without adding `/beta` to the URL.

Limited users can see whether their key is beta-enabled, but only admins can toggle the beta option.

## Required Provider Configuration

For a beta-path request to work, at least one routed candidate target must be beta-compatible.

A target is beta-compatible only when both of these are configured and valid:

```text
provider.pi_ai_provider
provider.models[model].pi_ai_model_id
```

In the UI, this means:

1. Set the provider's pi-ai provider in the provider advanced settings.
2. Set the pi-ai model ID for each provider model that should be eligible for beta routing.

The provider/model pair must be recognized by the pi-ai registry. If pi-ai does not know that provider/model pair, that target is not eligible for beta routing.

If a request enters the beta path and no valid beta-compatible target remains, the request fails closed. Plexus will not silently fall back to the legacy Transformer path.

This is intentional. A beta-path request should test pi-ai transformation only, not a mixture of pi-ai and legacy behavior.

## Routing Rules

Requests that enter `inference-v2` only consider beta-path eligible targets.

That means:

- Normal routing still applies first: aliases, model targets, priorities, key access policy, cooldowns, and concurrency all still matter.
- After routing candidates are found, `inference-v2` filters them to targets with valid pi-ai provider and pi-ai model hints.
- Targets without valid pi-ai hints are ignored for that request.
- If all candidates are filtered out, the request fails instead of using the old Transformer path.
- Failover can happen between beta-compatible targets only.
- There is no failover from pi-ai to Transformer within one request.

For non-beta keys using normal stable routes, the existing Transformer path remains in use.

## What Has Been Tested

All four supported request families have been tested through `inference-v2`:

- OpenAI chat completions, streaming and non-streaming.
- Anthropic messages, streaming and non-streaming.
- OpenAI Responses API, streaming and non-streaming.
- Gemini generateContent and streamGenerateContent.

Beta-key routing on stable paths has also been tested, including Responses and Gemini.

## What Works

The following pieces are expected to work in the beta path:

- API key authentication.
- Beta key routing from stable paths.
- Explicit `/beta/v1/...` paths for chat completions, messages, and responses.
- Gemini `generateContent` and `streamGenerateContent` through the beta key path.
- Model alias routing.
- Key access policy filtering.
- Candidate ordering and failover between beta-compatible targets.
- Provider cooldowns.
- Provider concurrency limits.
- Upstream attempt timeouts.
- Streaming first-token stall detection before any client frame is emitted.
- Quota checks before request execution.
- Quota usage recording after successful requests.
- Request logs and usage rows.
- Debug logs, including raw upstream request/response capture where available.
- Transformed request capture through pi-ai's payload callback.
- Transformed response snapshots for streaming and non-streaming requests.
- Token usage from pi-ai responses.
- Cost calculation using pi-ai usage and pricing data.
- `ttftMs`, `tokensPerSec`, and duration tracking.
- Response status tracking for success, error, timeout, and cancellation paths.
- Responses API `previous_response_id` and response storage behavior.
- Protocol-shaped streaming output for OpenAI, Anthropic, Responses, and Gemini.

In request logs, the pi character marks requests that went through the pi-ai native path. If you see the pi icon on a usage row, that request used `inference-v2` rather than the legacy Transformer path.

## Known Caveats

This is still a beta. Please expect rough edges.

- OAuth providers are not part of this beta path yet. Existing OAuth behavior still uses the older OAuth/pi-ai integration. Unifying OAuth with the new key-auth pi-ai executor is planned later.
- Embeddings, transcriptions, speech, image generation, and image edits are not part of this work. Those APIs stay on the existing Transformer path because pi-ai does not support those surfaces.
- Custom providers are entirely untested. Feedback is welcome, but please assume custom provider behavior may need fixes.
- Custom pi-ai provider/model IDs may not work unless pi-ai's registry recognizes them.
- Same-format passthrough is not used in the beta path. The beta path always parses the incoming request into a pi-ai Context and serializes the pi-ai result back to the client protocol.
- Some provider-specific request fields may be dropped if they are not represented in pi-ai Context or ProviderStreamOptions.
- URL image handling may not be equivalent across all formats/providers. Base64 image paths are the safer test case.
- Anthropic-style cache-control annotations on multiple system blocks may not preserve exactly the same behavior because system content is normalized into pi-ai context.

## What To Report

Plexus is self-hosted. Maintainers cannot inspect a reporter's request logs, debug logs, provider configuration, or client payloads unless those details are included in the bug report.

For a useful bug report, include enough information to reproduce or reason about the exact request path.

Include the client details:

- Client name and version.
- API format used: chat completions, Anthropic messages, Responses API, or Gemini.
- Whether the request was streaming or non-streaming.
- Whether the request used an explicit `/beta/...` route or a beta-enabled API key.
- The exact request path, with secrets removed.
- The model alias requested.

Include the Plexus routing/config details:

- The target provider name selected by Plexus, if known.
- The provider's `pi_ai_provider` value.
- The provider model's `pi_ai_model_id` value.
- Whether there were multiple routed targets for the alias.
- Whether any relevant providers were in cooldown or concurrency-limited.
- Whether the usage row showed the pi icon.

Include the request ID from the response header whenever possible:

```text
x-request-id: ...
```

Include the full trace for that request:

- The usage log row for the request.
- The debug log for the request, including raw request, transformed request, raw response, and transformed response when available.
- The client-visible response body or stream transcript.
- Any Plexus server log lines related to the request ID.
- Any upstream provider error body captured in the debug log.

Remove secrets before sharing traces:

- API keys.
- OAuth tokens.
- Provider credentials.
- Cookies.
- Private user data that is not needed to reproduce the issue.

Bug reports are especially useful when they identify the concrete mismatch, such as:

- The transformed request differs from what the provider expects.
- The raw provider response looks correct, but the transformed client response is malformed.
- Tool calls are missing, renamed, or malformed.
- Thinking/reasoning content is missing or in the wrong protocol field.
- Token usage or cost fields look wrong.
- A streaming response has invalid framing.

## Recommended First Tests

Start with simple prompts and one known-good beta-compatible provider/model target.

Then test:

- Streaming and non-streaming for the same model alias.
- Tool use, if your client relies on tools.
- Thinking/reasoning options, if your client sends them.
- Responses API continuation with `previous_response_id`, if your client uses Responses state.
- Gemini streaming, checking that frames are `data: <json>` separated by blank lines.
- Failover by temporarily cooling down or disabling one beta-compatible target while another remains available.

## Current Bottom Line

The beta path is ready for focused testing on chat completions, Anthropic messages, OpenAI Responses, and Gemini.

The most important configuration rule is: if you route a request into beta, make sure the selected target has both a valid pi-ai provider and a valid pi-ai model ID. Beta-routed requests only consider beta-compatible targets and do not fall back to the legacy Transformer path.
