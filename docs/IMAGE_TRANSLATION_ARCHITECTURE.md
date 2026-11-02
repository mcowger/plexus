# Image translation architecture

**Status:** buffered translation phase implemented; streaming and discovery remain deferred.

## Decision and scope

Use the dedicated [OpenRouter Image API request shape](https://openrouter.ai/docs/api/api-reference/images/generate-an-image)
as the inbound vocabulary, but make Plexus's image intermediate representation (IR) the internal
contract. OpenRouter compatibility is a boundary format, not an upstream dependency or the IR itself.

```text
OpenRouter-shaped JSON request
  -> ingress validation and normalization
  -> canonical Plexus image request IR
  -> Plexus candidate selection and admission
  -> target-specific OpenAI-compatible, OpenRouter, Gemini, or Codex image transformer
  -> upstream request
  -> target-specific response normalization
  -> canonical Plexus image response
  -> client-format response
```

The initial implementation covers buffered text-to-image and reference-image-conditioned generation
against configured OpenAI Images-compatible image endpoints, the dedicated OpenRouter `/images` endpoint,
native Gemini image-generating models, and the ChatGPT-subscription Codex Images backend. The configured
target API types are `chat` (OpenAI-compatible), `openai-images`, `openrouter-images`, `gemini`, and
`codex-images`. `utils/api-format.ts` holds that set once as `IMAGE_TARGET_API_TYPES`; the router's
image-capability filter and target API selection both read it from there rather than keeping their own
copies.

Preserve the existing `/v1/images/generations` JSON and `/v1/images/edits` multipart compatibility
surfaces; they converge on the same image IR rather than acquiring separate provider pipelines.
“OpenRouter-shaped” means `model`, `prompt`, and image options, **not** chat `messages`/`modalities` or
Responses API `image_generation` tools. The supplied multimodal guide's chat-completions image path and
the existing tool paths stay outside the image IR: the only chat-shaped requests this covers are those
whose resolved model is itself an image model, which the chat-to-image bridge converts into an ordinary
image request before any target-specific work happens.

Streaming, partial-image events, image-model discovery, and per-endpoint capability/pricing discovery
are deferred. Use existing provider/model configuration; do not add discovery endpoints or claim full
OpenRouter API parity. `stream: true` must receive an explicit unsupported-feature error in this phase,
not silently start a buffered request. Imagen `:predict`, additional native provider protocols, and
cross-provider mask/inpainting equivalence are not implied by this support.

Partial-image streaming remains deferred for every target, Codex included: a Codex image request with
`stream: true` is a 501, not a buffered fallback. Also deferred on the Codex path are JSON edits
ingress on the compatibility surface, bridging chat requests onto Plexus's own host chat models, and
parsing Codex usage-limit headers into the `image_gen` quota window — the latter belongs with quota
checker work, not here.

## Canonical request IR

Normalize once at ingress; build a fresh target payload for every attempt. The IR contains:

- **Identity:** requested model/alias, prompt, request ID, and existing Plexus access/telemetry metadata.
- **Output intent:** count (`n`), resolution tier, aspect ratio, explicit dimensions, quality, output
  encoding, background, compression, and seed. Preserve legacy `size`, `style`, `user`, and
  `response_format` semantics at the compatibility boundary where applicable.
- **Inputs:** an ordered list of typed reference images, with MIME type and either a remote URL or
  decoded bytes; optional mask data remains distinct from an ordinary reference image.
- **Routing intent:** provider restrictions/order/fallback preference, separated from generation
  options and target-scoped provider options.

The OpenRouter vocabulary includes `resolution`, `aspect_ratio`, `size`, `quality`, `output_format`,
`background`, `output_compression`, `seed`, `n`, and `input_references`. Normalize a tier-valued `size`
into resolution intent; retain explicit pixel dimensions and reject conflicting size/resolution/ratio
inputs. Do not reinterpret output encoding (`png`, `jpeg`, `webp`, etc.) as delivery format
(`url` versus `b64_json`). Acceptance into the IR is not a promise that every model supports a value.

Transformers map only supported options. Required semantics such as reference images or masks must
never disappear silently; unsupported target/request combinations need an explicit error. Capability
limits belong to the target implementation/configuration until discovery exists. In particular, `n`
is an upper bound, not a reason to invent repeated upstream calls for a single-image model. Preserve
unset values so upstream defaults remain available.

## Provider preferences and target selection

Keep three decisions separate: selecting a Plexus provider/model, selecting its wire protocol, and
applying options understood by that target.

- `provider.only` restricts eligible **configured Plexus provider names**; `provider.ignore` excludes
  them. Neither creates providers nor bypasses alias membership, key policy, quotas, cooldowns, or
  concurrency limits. An empty eligible set is an error, not permission to ignore restrictions.
- `provider.order` ranks eligible providers; it is not an allowlist. Unlisted eligible providers remain
  fallback candidates. With no request preference, preserve configured Plexus routing behavior.
- `provider.allow_fallbacks: false` limits the request to its primary eligible target. `true` cannot
  override globally disabled failover, and does not make non-retryable errors retryable.
- `provider.sort` is a routing preference, not an image parameter. Any supported price/throughput/
  latency mapping must use meaningful Plexus ranking data; do not equate chat token throughput with
  image throughput. Reject unsupported sort forms rather than pretending to implement OpenRouter's
  full ranking behavior.
- `provider.options` is scoped by configured provider name. Only the selected target's supported
  options reach its transformer; never send another provider's options or the entire routing object
  to OpenAI/Gemini/OpenRouter. OpenRouter's external provider tags are not automatically Plexus provider names.
  Routing within an OpenRouter upstream, if configured, is a separate provider-specific concern.

Resolve the wire protocol from the selected target's model `access_via` and provider configuration,
not from the incoming JSON shape or a model-name substring. A Gemini target must use a Gemini image
transformer even though the ingress API is `images`. Follow the embeddings factory's dedicated-provider
pattern, while respecting model-level restrictions and configured URLs. Retain existing dispatch
admission, retry history, error handling, and observability rather than creating a second router.

## Reference images and target transforms

Inbound `input_references` entries use the OpenRouter form:

```json
{
  "type": "image_url",
  "image_url": { "url": "data:image/png;base64,..." }
}
```

HTTP(S) URLs are also accepted. Multipart image uploads become the same typed references. Preserve
reference order and actual MIME types; do not hardcode JPEG or flatten images into prompt text.
Resolve remote bytes only when the selected protocol requires them. Downloads are an external-input
boundary: enforce URL/redirect safety, timeouts, size limits, and accepted image content types without
forwarding provider credentials. Rebuild consumed multipart bodies per attempt; adapters may resolve a
remote reference again on a later failover attempt. Reference images are not masks, and a mask cannot
be dropped on Gemini, OpenRouter, or Codex.

| Target                                            | Request mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Response mapping                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI-compatible images                          | JSON `/images/generations` for text-only input; multipart `/images/edits` when reference images require editing input, sent as a single `image` part or `image[]` repeated per file (at most 16). Map supported image options according to the target's capabilities. Use bearer auth and let multipart serialization set its boundary.                                                                                                                                                                                                                                                                                                                     | Normalize `data[]` URL/base64 items, revised prompts, and reported usage.                                                                                                      |
| Dedicated OpenRouter images (`openrouter-images`) | `/images` relative to the configured OpenRouter API base. Rebuild the supported normalized fields and reference-image entries; do not forward the original body. Use bearer auth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Normalize OpenRouter `data[]` and `usage` into the canonical image response.                                                                                                   |
| Native Gemini images                              | `/v1beta/models/{model}:generateContent`, with prompt and reference `inlineData` parts in `contents`; request image output via `generationConfig.responseModalities` and map ratio/resolution to `imageConfig.aspectRatio`/`imageSize` where supported. Use Gemini authentication.                                                                                                                                                                                                                                                                                                                                                                          | Extract generated image `inlineData` parts and their MIME types; normalize `usageMetadata`. Do not treat text-only or safety-blocked responses as successful image generation. |
| Codex Images (`codex-images`)                     | JSON `/images/generations`, or JSON `/images/edits` when the request carries reference images, under `https://chatgpt.com/backend-api/codex`. Generations send `prompt` and `model` plus `size`, `n`, `quality`, and `background` when set; edits send `images[].image_url` data URLs (at most five), `prompt`, `model`, `n` when set, and `background`/`quality`/`size` defaulted to `auto`. Aspect ratios map by orientation to `1024x1024`, `1536x1024`, or `1024x1536`; tier-valued `size` uses the shared tier table. Authenticate with the Codex OAuth bearer plus `chatgpt-account-id`, `originator`, `Version`, and `User-Agent`; no `OpenAI-Beta`. | Read `data[].b64_json`, take `media_type` from the response's top-level `output_format`, and normalize `usage`. An empty `data[]` is a 502 rather than an empty success.       |

Codex Images speaks a narrow subset of the IR, so everything it cannot express is an explicit 400:
`response_format: "url"`, `output_format`, `output_compression`, `seed`, `style`, `user`, `mask`, and
an `aspect_ratio` with no orientation mapping. The upstream request id from
`x-codex-imagegen-request-id` is logged so a gateway trace can be correlated with an upstream ticket.

Use image-specific OpenRouter, Gemini, and Codex transformers. The existing chat builder is not an image capability layer,
and its response transformer currently extracts text/tool calls rather than generated image bytes.
Do not assume arbitrary HTTP URLs are valid Gemini file-service URIs.

Provider/model/alias `extraBody` remains a trusted configuration extension, not a replacement for
canonical fields or a way to mix wire formats. Preserve the existing generation precedence
(provider, then model, then alias overrides) when composing target-specific payloads, and document
unsupported multipart overrides rather than introducing accidental behavior.

## Generation and edit convergence

`/v1/images/generations` and `/v1/images/edits` share one request type and one dispatch loop. The
multipart edits route parses its upload into a single `UnifiedImageGenerationRequest` whose
`input_references[0]` is the uploaded image and whose optional `mask` stays a distinct field, then
calls `dispatchImageGenerations`. There is no separate edit dispatch path: whether a target issues a
generation or an edit is a transformer decision driven by the presence of `input_references`.

The route reads the upload from whichever shape the multipart plugin produced: first the body
`@fastify/multipart` attaches — it is registered with `attachFieldsToBody: true` in `index.ts`,
which consumes the request before the handler runs — then, failing that, streaming `request.parts()`.
Handling only the streaming shape is what left this ingress non-functional on the running server.

An upload whose declared MIME type is not `image/*` is sniffed from its magic bytes instead of being
trusted or rejected outright, and `response_format` is forwarded only when the client actually sent
it. That changes one behaviour on `/v1/images/edits`: a request omitting `response_format` now
receives the provider's own default (`url` for `dall-e-2`) rather than the `b64_json` the multipart
builder used to force. `/v1/images` is unaffected because it defaults `response_format` to
`b64_json` at parse time, and `/v1/images/generations` is unaffected because that legacy route never
carries `input_references` and so never reaches the multipart builder.

`UnifiedImageEditRequest`, `UnifiedImageEditResponse`, `Dispatcher.dispatchImageEdits`, and the
OpenAI transformer's `parseEditRequest`/`transformEditRequest`/`transformEditResponse` remain as
deprecated compatibility facades; `editRequestToGenerationRequest` converts the old shape into the
canonical one. New code targets the generation request directly.

Masks stay explicit at every target. The OpenAI multipart path appends `mask`; the Gemini,
OpenRouter, and Codex transformers reject it with an explicit error rather than dropping it.

## Canonical response and normalization

Return a single image response model: `created` (Unix seconds), ordered `data[]`, and optional usage.
Each image carries bytes/base64 or a usable URL, its actual `media_type` when known, and an optional
`revised_prompt`. Use one receipt timestamp when an upstream supplies no creation time. Preserve all
returned images; auxiliary Gemini text is not image data or a fabricated revised prompt.

Normalize OpenAI input/output token fields and Gemini `usageMetadata` to Plexus's internal usage
names. The OpenRouter-shaped formatter projects these to `prompt_tokens`, `completion_tokens`, and
`total_tokens`, with reported cost when available. Do not invent zero usage or cost when absent.

Image token detail survives the Responses transform path. `usage-normalizer.ts` reads
`input_tokens_details.image_tokens` and `output_tokens_details.image_tokens` into
`UnifiedUsage.input_image_tokens` / `output_image_tokens`, and a single `buildResponsesUsagePayload`
helper re-emits them in the detail blocks — only when the unified fields are actually present, so a
target that reports no image tokens does not gain fabricated zeros.

For the OpenRouter-shaped response, emit `b64_json` image bytes and `media_type`; materialize URL-only
upstream results through the same bounded fetch policy. Preserve legacy URL/base64 delivery when the
selected compatibility surface and target support it. Do not manufacture hosted URLs, mislabel bytes
as PNG, or promise transcoding. Keep raw provider responses and internal `plexus` routing/configuration
metadata out of the client payload. Record the actual upstream protocol and translation status rather
than unconditionally marking image requests as passthrough.

## Chat-to-image bridge

A client that only speaks a chat surface can reach an image model by naming it. When a request
arriving on `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, the Gemini surface, or
`/v1/completions` resolves to an image-typed model, `services/dispatch/image-model-bridge.ts`
converts it into an image request, dispatches it through the same `dispatchImageGenerations` the
REST image surface uses, and synthesizes unified output. The seam sits in `request-manager.ts` after
candidate resolution and before the per-target loop, so alias lookup, `additional_aliases`,
`direct/` syntax, key access policy, quota skips, admission, failover, and attempt metadata all
behave exactly as they do for a REST image request.

**Detection** is configuration-driven and never reads `request.tools`. The resolved alias's
`type: image` is authoritative; failing that, every candidate's provider-model config must declare
`type: image`. A mixed candidate set with no alias-level type is ambiguous — the alias fans out
across image and non-image targets — so it is not bridged, and a warning names the alias so an
operator can add the alias-level type. Plexus's own vision-descriptor requests never bridge.

**Request building** takes the last user message as the prompt; earlier turns are conversation
history an image model has no way to consume. That message's `image_url` parts become
`input_references`, which is what turns an attached image into an edit downstream. A legacy
Completions request has no messages worth reading, so its raw `prompt` field is the instruction, and
a request with no prompt text at all is a validation error. `n` is `1`. Size, quality, background,
and output format are deliberately left unset so provider, model, and alias `extraBody` and the
target transformer's own defaults still decide them, exactly as on the REST surface.
`previous_response_id` carries no image state, so a follow-up bridges as a fresh generation.

**Response synthesis** returns already-unified output tagged `plexus.apiType = 'images'`, carrying
the provider/model/pricing and attempt metadata the image dispatch attached. A Responses-format
client receives native `image_generation_call` output items; chat-, Messages-, Gemini-, and
Ollama-format clients receive a markdown data URI. On the streaming path each chunk-level typed
carry is paired 1:1 with its markdown rendering on the same chunk's `delta.content`: chat-format
clients render the markdown, and the Responses formatter re-emits the native item and structurally
skips the paired delta. The finish chunk must carry usage, because a streamed response records its
usage from the client-facing transformed snapshot. No client formatter needed a change for this.

`transformers/image-bridge.ts` supplies the `images` entry in `TransformerFactory` as a deliberate
no-op. It defines no `transformStream`, and the response handler only calls `transformStream` when
the transformer defines one — that absence is what lets the synthesized unified chunk stream reach
the client formatter instead of being parsed as provider SSE bytes. Its request-side methods throw,
since nothing is ever dispatched over an `images` "wire". `debug-logging.ts` taps the `images`
provider type in object mode for the same reason and skips raw reconstruction, whose input would be
unified chunks rather than wire bytes.

### Responses `image_generation` tools

An explicit `image_generation` tool on an ordinary chat model is untouched by the bridge: detection
ignores tools entirely, so such a request keeps its normal tool semantics. The Responses parser
passes built-in server-side tool definitions through unchanged so provider adapters can coerce them,
and results that come back as native `image_generation_call` output items are carried typed through
the unified response and re-emitted natively to Responses clients.

`tool_choice` is the one lossy edge, and how lossy depends on the path. On the transform path
(`convertToolChoiceForChatCompletions`) the Responses-to-unified conversion preserves string forms
and `{ type: 'function' }` and maps everything else to `auto`, so a `tool_choice` naming a built-in
tool such as `image_generation` becomes `auto` and the tool is offered rather than forced. On the
native Codex Responses path the client's `tool_choice` is passed through verbatim —
`adornCodexResponsesBody` only supplies `auto` when the field is absent — and the ChatGPT backend
accepts it: a probed `tool_choice: { type: 'image_generation' }` on a Codex chat model returned an
`image_generation_call` output item (the "Responses `image_generation` tool, unary" row under
[Live probe results](#live-probe-results)). Forcing a built-in image tool therefore works on the
native path but not through the transform path; name an image-typed model and let the bridge handle
it when the image output is required regardless of route.

## File-level extension points

Paths below are relative to `packages/backend/src/` unless otherwise noted. New paths listed here
are part of the implemented buffered phase.

| File                                                                                                                                   | Responsibility / implementation seam                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/inference/images.ts`                                                                                                           | Ingress validation, OpenRouter-shaped parsing, compatibility multipart parsing, request context, and client response formatting for `/v1/images`, `/v1/images/generations`, and `/v1/images/edits`. The public incoming operation remains `images`; target protocol names are separate.                                                               |
| `routes/inference/index.ts`                                                                                                            | Keep image entrypoints within the existing authenticated route registration.                                                                                                                                                                                                                                                                          |
| `types/unified.ts`                                                                                                                     | Extend the current `UnifiedImageGeneration*` / `UnifiedImageEdit*` types into the canonical image contract, including references, output intent, MIME types, and normalized usage.                                                                                                                                                                    |
| `transformers/image.ts` and `transformers/index.ts`                                                                                    | Current OpenAI-only parser/builder/formatter and exports; retain compatibility entrypoints while separating inbound normalization from target mapping.                                                                                                                                                                                                |
| **New:** `types/image-transformer.ts`                                                                                                  | Image-specific endpoint/auth, request-body, and response-normalization contract; use `types/embeddings-transformer.ts` as precedent, not the chat streaming interface.                                                                                                                                                                                |
| `transformers/image.ts`, **new:** `transformers/images/openrouter.ts`, `transformers/images/gemini.ts`, `transformers/images/codex.ts` | OpenAI-compatible, dedicated OpenRouter, native Gemini, and Codex Images target-specific JSON/multipart construction, option mapping, and response decoding. The existing file retains the legacy parser/edit compatibility surface and the shared tier-size table, reference resolution, and usage normalization the target transformers reuse.      |
| `utils/api-format.ts`                                                                                                                  | `IMAGE_TARGET_API_TYPES` and `isImageTargetApiType` — the single list of API types that can serve an incoming `images` request. Add a new image protocol here, not in the router and provider API selection separately.                                                                                                                               |
| `services/oauth/oauth-native-request.ts`                                                                                               | `buildCodexOAuthHeaders` is the shared Codex OAuth identity (bearer, `chatgpt-account-id`, `originator`, `Version`, `User-Agent`) used by both Responses and images; `prepareCodexImagesDispatch` resolves the token and the `<base>/codex` base URL for an image dispatch, without the Responses-only `OpenAI-Beta` flag.                            |
| **New:** `services/dispatch/image-transformer-factory.ts`                                                                              | Select an image transformer per target; `embeddings-transformer-factory.ts` is the existing pattern.                                                                                                                                                                                                                                                  |
| `services/dispatch/dispatcher.ts`                                                                                                      | Keep the existing `dispatchImageGenerations` facade and media-dispatch delegation. `dispatchImageEdits` survives only as a deprecated wrapper over `editRequestToGenerationRequest`.                                                                                                                                                                  |
| `services/dispatch/media-dispatcher.ts`                                                                                                | Select target protocol and transformer per attempt, construct target-native requests, and preserve policy, admission, failover, and metadata handling. `resolveImageDispatchTarget` is the auth seam: an OAuth route must resolve to `openai-codex` plus `codex-images` or the request is rejected, and debug payloads have their data URLs redacted. |
| **New:** `services/dispatch/image-model-bridge.ts`                                                                                     | Chat-to-image detection, image request building from a chat-shaped request, and unified response/stream synthesis.                                                                                                                                                                                                                                    |
| **New:** `transformers/image-bridge.ts`, `services/dispatch/transformer-factory.ts`                                                    | The no-op `images` provider transformer and its factory entry, which keep bridged unified output out of the provider SSE parsing path.                                                                                                                                                                                                                |
| `services/dispatch/request-manager.ts`, `services/inspectors/debug-logging.ts`                                                         | The bridge seam after candidate resolution, and object-mode debug capture for the synthesized `images` stream.                                                                                                                                                                                                                                        |
| `services/routing/router.ts`, `services/providers/provider-api-selection.ts`                                                           | Apply image routing preferences and protocol eligibility without conflating API name matching with image capability; resolve target-specific base URLs.                                                                                                                                                                                               |
| `transformers/gemini/part-mapper.ts`, `utils/usage-normalizer.ts`                                                                      | Existing reference points for Gemini parts and usage. Reuse only semantics that preserve image MIME/data correctly.                                                                                                                                                                                                                                   |
| `docs/openapi/paths/v1_images*.yaml`, `docs/openapi/components/schemas/Image*.yaml` (repository root)                                  | Publish the buffered `/v1/images` and legacy image request/response contracts.                                                                                                                                                                                                                                                                        |

### Implemented baseline

The buffered phase now accepts `/v1/images` plus the existing OpenAI-compatible image routes, and
chat-shaped requests that name an image-typed model. Image requests are normalized into the unified
IR, provider preferences are applied before admission, image capability filtering prevents explicitly
text/embedding targets from being selected, and target API selection chooses an OpenAI-compatible,
dedicated OpenRouter, native Gemini, or Codex Images transformer per attempt. OpenAI-compatible
requests use JSON generation or multipart editing for one or more references; OpenRouter requests use
`/images`; Gemini requests use native `generateContent` with image response modalities and inline
reference data; Codex requests use JSON `/images/generations` or `/images/edits` under the ChatGPT
backend with Codex OAuth headers. Generations and edits share one request type and one dispatch
loop. Responses and usage are normalized at the image boundary, while partial-image streaming,
image-model discovery, and additional native provider protocols remain deferred.

## Verification

Backend coverage runs with `bun test`; the OpenAPI document is checked with
`bun run lint:openapi` and its compiled asset is regenerated with `bun run generate:openapi:asset`. The Codex target,
the edits convergence, and the chat-to-image bridge each carry unit coverage beside their sources
(`transformers/__tests__/image-codex.test.ts`,
`services/dispatch/__tests__/image-model-bridge.test.ts`,
`services/__tests__/dispatcher-codex-images.test.ts`, and the image-bridge formatter and route
tests).

### Live probe results

Run on 2026-09-08 against the local dev stack (`feat/codex-oauth-images` working tree) with an OpenAI Codex OAuth account (`x-codex-plan-type: prolite`), through Plexus aliases `codex-image` → `codex/gpt-image-2`, `codex-image-25-flare` → `gpt-image-2.5-flare`, `codex-image-25-sunburst` → `gpt-image-2.5-sunburst`, and `codex-chat` → `gpt-5.4` → failover `gpt-5.6-sol`. Every row is one real request; "b64" is the base64 length of the returned image.

| Probe                                                  | Request                                                                                                                                                                   | Result                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline generation                                    | `POST /v1/images/generations` `{model: codex-image, prompt, size: 1024x1024, quality: low}`                                                                               | 200; 1 PNG (b64 954 220); `media_type: image/png`; usage `input_tokens 13` (`text_tokens 13`), `output_tokens 515` (`image_tokens 515`); upstream payload was exactly `{prompt, model: gpt-image-2, size, quality}`; upstream response carried `x-codex-imagegen-request-id` |
| OpenRouter-shaped generation                           | `POST /v1/images` `{model: codex-image, prompt, quality: low}`                                                                                                            | 200; 1 PNG; usage projected to `prompt_tokens/completion_tokens/total_tokens`                                                                                                                                                                                                |
| Multipart edit                                         | `POST /v1/images/edits` (multipart: `model`, `prompt`, `image=@png`)                                                                                                      | 200 after the attached-body ingress fix; 1 PNG (b64 1 453 384); usage `input_tokens 1547` (`image_tokens 1521`), `output_tokens 515`; upstream `/codex/images/edits` JSON body                                                                                               |
| Bridge, chat completions                               | `POST /v1/chat/completions` `{model: codex-image, messages:[user text]}`                                                                                                  | 200; assistant content is a markdown data URI (1 092 202 chars); `finish_reason: stop`; usage `prompt_tokens 13`, `completion_tokens 515`                                                                                                                                    |
| Bridge, chat streaming                                 | same with `stream: true`                                                                                                                                                  | 200; 2 `chat.completion.chunk` frames + `[DONE]`; markdown data URI in `delta.content`; usage on the finish chunk                                                                                                                                                            |
| Bridge, Responses                                      | `POST /v1/responses` `{model: codex-image, input: text}`                                                                                                                  | 200; `output` = `image_generation_call` (b64 996 476) + `message`                                                                                                                                                                                                            |
| Bridge, Messages                                       | `POST /v1/messages` `{model: codex-image, ...}`                                                                                                                           | 200; one `text` block holding the markdown data URI; `stop_reason: end_turn`                                                                                                                                                                                                 |
| Bridge with a reference image                          | chat completions, user content = text + `image_url` data URL                                                                                                              | 200; routed to `/codex/images/edits`; usage `prompt_tokens 1541`                                                                                                                                                                                                             |
| `gpt-image-2.5-flare`                                  | `POST /v1/images/generations` `{model: codex-image-25-flare, prompt}`                                                                                                     | 200; 1 PNG (b64 797 508); usage `output image_tokens 515` — **accepted by the Codex backend**                                                                                                                                                                                |
| `gpt-image-2.5-sunburst`                               | `POST /v1/images/generations` `{model: codex-image-25-sunburst, prompt}`                                                                                                  | 200; 1 PNG (b64 945 732) — **accepted by the Codex backend**                                                                                                                                                                                                                 |
| Optional `output_format: webp` (via model `extraBody`) | generation on `gpt-image-2`                                                                                                                                               | 200 but the returned `media_type` (derived from the upstream `output_format`) is `image/png` and the bytes are PNG; the field is not honoured (the `extraBody` merge itself is covered by unit tests; the upstream trace was not captured)                                   |
| Optional `output_compression: 50`                      | same                                                                                                                                                                      | 200; PNG returned; no visible effect                                                                                                                                                                                                                                         |
| Optional `n: 2`                                        | same                                                                                                                                                                      | 200; **one** image returned                                                                                                                                                                                                                                                  |
| Optional `background: transparent`                     | same                                                                                                                                                                      | 200; PNG returned; opacity not verified                                                                                                                                                                                                                                      |
| Optional `size: auto`                                  | same                                                                                                                                                                      | 200; PNG returned                                                                                                                                                                                                                                                            |
| Rejection `response_format: url`                       | `POST /v1/images/generations` `{model: codex-image, prompt, response_format: url}`                                                                                        | 400 `invalid_request_error`: "Codex image targets return base64 image data rather than URL responses"                                                                                                                                                                        |
| Explicit tool on a chat model is not bridged           | `POST /v1/responses` `{model: codex-chat, tools:[{type: image_generation}], tool_choice: none}`                                                                           | 200; `output` = `message` only; request went to `/codex/responses`                                                                                                                                                                                                           |
| Responses `image_generation` tool, unary               | `POST /v1/responses` `{model: codex-chat, tools:[{type: image_generation, model: gpt-image-2, size, quality: low}], tool_choice: {type: image_generation}, store: false}` | 200; `output` = `image_generation_call` (b64 964 612) + `message`; usage `input_tokens 2310`, `output_tokens 58`; `tool_choice` naming the built-in tool was passed through on the native Codex path and accepted                                                            |
| Responses `image_generation` tool, streaming           | same with `stream: true`                                                                                                                                                  | 200; 13 native frames including `response.image_generation_call.in_progress/generating/completed`, two `response.output_item.done`, `response.completed`                                                                                                                     |
| Chat completions with the `image_generation` tool      | `POST /v1/chat/completions` `{model: codex-chat, tools:[{type: image_generation, ...}]}`                                                                                  | 200; markdown data URI (1 034 726 chars); usage `prompt_tokens 2303`, `completion_tokens 51`                                                                                                                                                                                 |

Not exercised: a non-image model id under `access_via: ["codex-images"]` (the temporary alias resolved to no healthy target before dispatch, so the upstream behaviour for an unknown image model id remains unverified). `gpt-5.5` works for this account (an earlier 404 was transient); `gpt-5.4` is rejected by Codex for ChatGPT accounts ("not supported when using Codex with a ChatGPT account") and the Responses-tool probes succeeded via alias failover to `gpt-5.6-sol`. The live model list from `/codex/models` reflects this: it omits `gpt-5.4` and lists `gpt-5.5`.

Conclusions: the Codex backend accepts `gpt-image-2`, `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`; it ignores `output_format` and `output_compression` rather than rejecting them, so the transformer keeps rejecting those fields explicitly instead of forwarding them; `n` is forwarded but `n > 1` still yields one image; every returned image was PNG.

Codex CLI's `$imagegen` command posts to `https://chatgpt.com/backend-api/codex/images/generations`
and `.../images/edits`, and hardcodes `gpt-image-2` — confirmed against the openai/codex sources.
The ChatGPT Images 2.5 API model IDs are `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`, and the
probes confirm the Codex backend accepts both.

`response_format: "url"`, `output_format`, `output_compression`, `seed`, `style`, `user`, and `mask`
stay explicit 400s. For `output_format` and `output_compression` that is a deliberate choice rather
than an upstream constraint: the probes show the backend accepts and then silently ignores them, so
forwarding would hand back an image that quietly disagrees with the request. `n` is the exception:
it is forwarded, and the backend simply returns one image regardless — which is the IR's rule that
`n` is an upper bound, not a promise, rather than a reason to reject the field.
