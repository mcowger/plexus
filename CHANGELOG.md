# Changelog

## v0.12.0 - 2026-02-05

### v0.12.0: Support Oauth/Subscription Providers:  Codex, Claude Pro, Antigravity, GeminiCLI, Github Copilot

## Main Features

- **OAuth Authentication Integration**: Implemented a full OAuth login flow, including backend services and frontend UI components. This release introduces support for OAuth providers and a specialized OAuth transformer designed for streaming support.
  - Backend/Frontend integration: [11c8917](https://github.com/mcowger/plexus/commit/11c8917), [7034b59](https://github.com/mcowger/plexus/commit/7034b59)
  - OAuth transformer with streaming: [22ea201](https://github.com/mcowger/plexus/commit/22ea201)

## Smaller Changes and Fixes

- **Stream Event Refinement**: Improved the streaming response logic to align with API specifications and provide richer data during inference.
  - Align responses stream events with API: [6f6aa00](https://github.com/mcowger/plexus/commit/6f6aa00)
  - Emit reasoning summary and output items in stream: [c2f41da](https://github.com/mcowger/plexus/commit/c2f41da), [20784d9](https://github.com/mcowger/plexus/commit/20784d9)
  - Finalize tool calls within the responses stream: [a08fe9d](https://github.com/mcowger/plexus/commit/a08fe9d)
- **Validation & Schemas**: Integrated TypeBox for robust schema validation and added validation for OAuth models.
  - Document auth JSON and add TypeBox: [f858cf5](https://github.com/mcowger/plexus/commit/f858cf5)
  - Validate OAuth models and known lists: [3854e26](https://github.com/mcowger/plexus/commit/3854e26)
- **UI and UX Fixes**:
  - Display OAuth provider icons in logs: [38897da](https://github.com/mcowger/plexus/commit/38897da)
  - Pass response options to OAuth flow: [c35af6b](https://github.com/mcowger/plexus/commit/c35af6b)
  - Filter pi-ai request options: [3f76d19](https://github.com/mcowger/plexus/commit/3f76d19)
- **Maintenance & Tooling**:
  - Added OAuth test payloads and labels: [651b24e](https://github.com/mcowger/plexus/commit/651b24e)
  - Updated README and test configurations: [26e31b6](https://github.com/mcowger/plexus/commit/26e31b6), [51fb3a7](https://github.com/mcowger/plexus/commit/51fb3a7)
  - Ignore local auth artifacts and remove runtime data: [2a4b83e](https://github.com/mcowger/plexus/commit/2a4b83e)

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.11.1 - 2026-02-04

### v0.11.1: Implementation of Server-Side Quota Forecasting and Database Resiliency Fixes

### Main New Features

* **Quota Exceedance Estimation**: Introduced server-side logic to estimate quota exhaustion using historical data analysis ([d22a73d](https://github.com/mcowger/plexus/commit/d22a73d)).

### Technical Changes and Fixes

* **Database Reliability**: Implemented comprehensive error handling for database timeout issues and corrected Drizzle ORM API usage during response cleanup ([aff2e30](https://github.com/mcowger/plexus/commit/aff2e30), [36d9910](https://github.com/mcowger/plexus/commit/36d9910)).
* **Quota Logic Improvements**: Resolved issues with quota snapshot deduplication, `resetInSeconds` calculation, and schema initialization ([c297f84](https://github.com/mcowger/plexus/commit/c297f84), [0d469b5](https://github.com/mcowger/plexus/commit/0d469b5)).
* **UI Enhancements**: Refactored quota reset displays into integrated labels and updated the 'Tokens' column with fixed widths and null-set symbols for zero-cost entries ([7973c41](https://github.com/mcowger/plexus/commit/7973c41), [4db76e2](https://github.com/mcowger/plexus/commit/4db76e2)).
* **Cleanup**: Removed unnecessary code artifacts ([41a3a24](https://github.com/mcowger/plexus/commit/41a3a24)).

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.11.0 - 2026-02-04

### v0.11.0: OpenAI-Compatible Responses API and Enhanced Model Test Suite

### Main Features

- **OpenAI-Compatible Responses API**: Added core support for OpenAI-compatible responses API ([565890f](https://github.com/mcowger/plexus/commit/565890f)).

### Minor Changes and Improvements

- **Model Testing & Filtering**: Improved model testing procedures and added API filtering logic ([f5418ba](https://github.com/mcowger/plexus/commit/f5418ba)).
- **Embeddings and Images**: Added test support for embeddings and image-based data types ([f12da0f](https://github.com/mcowger/plexus/commit/f12da0f)).
- **Responses API Testing**: Implemented unit and integration test support for the newly added responses API ([040f32d](https://github.com/mcowger/plexus/commit/040f32d)).

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.10.3 - 2026-02-03

### v0.10.3: UI Enhancements for Model Alias Management

### New Features

- **Model Alias Removal**: Added a new interactive button within the user interface to facilitate the removal of model aliases. ([1be57fe](https://github.com/mcowger/plexus/commit/1be57fe))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.10.2 - 2026-02-03

### v0.10.2: Implementation of Quota Tracking System and Sidebar UI Redesign

## v0.10.2 Release Notes

### Main Features

- **Backend Quota Tracking**: Introduced a robust quota tracking system featuring periodic backend checking to monitor resource usage automatically ([9ea0638](https://github.com/mcowger/plexus/commit/9ea0638)).
- **Naga.ac Support**: Added specialized quota tracking and frontend display components specifically for Naga.ac integration ([385bff3](https://github.com/mcowger/plexus/commit/385bff3)).
- **UI Redesign**: Implemented a new compact sidebar with collapsible sections, optimizing workspace layout while integrating real-time quota displays ([a90da6e](https://github.com/mcowger/plexus/commit/a90da6e), [23afa69](https://github.com/mcowger/plexus/commit/23afa69)).

### Other Changes

- **Models Page Layout**: Consolidated the header layout on the Models page for better visual consistency ([ba55504](https://github.com/mcowger/plexus/commit/ba55504)).
- **Logs Table Optimization**: Enhanced the styling and layout of the Logs table to improve readability and data density ([be7c2b4](https://github.com/mcowger/plexus/commit/be7c2b4)).
- **Backend Maintenance**: Removed legacy and unused quota checker logic to streamline the codebase ([32c0913](https://github.com/mcowger/plexus/commit/32c0913)).

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.10.1 - 2026-02-03

### v0.10.1: OpenAI-Compatible Image APIs, Usage-Based Load Balancing, and Enhanced Metadata Logging

## New Features

- **OpenAI-Compatible Image APIs**: Added support for image generation and editing endpoints ([6b3ed1f](https://github.com/mcowger/plexus/commit/6b3ed1f)).
- **Usage-Based Load Balancing**: Implemented a new `UsageSelector` strategy to improve load balancing logic ([48902f4](https://github.com/mcowger/plexus/commit/48902f4)).
- **Request/Response Metadata Logging**: Enhanced usage logs to capture and display detailed request and response metadata ([5d57657](https://github.com/mcowger/plexus/commit/5d57657)).

## Bug Fixes and Improvements

- **Backend Updates**:
  - Fixed correlated `EXISTS` subqueries and handled SQLite boolean coercion for `hasDebug` and `hasError` flags ([5a66237](https://github.com/mcowger/plexus/commit/5a66237), [90c650e](https://github.com/mcowger/plexus/commit/90c650e)).
  - Improved `UsageInspector` to correctly extract `cached_tokens` from OpenAI responses ([3c67f20](https://github.com/mcowger/plexus/commit/3c67f20), [955ae06](https://github.com/mcowger/plexus/commit/955ae06)).
  - Ensured `message_delta` payloads always include the required usage field ([bdb71bb](https://github.com/mcowger/plexus/commit/bdb71bb)).
  - Aligned `InferenceError` interface with current API response formats ([39f3838](https://github.com/mcowger/plexus/commit/39f4e38)).
- **Frontend & UI**:
  - Restructured the logs table `meta` column into a stacked 2x2 grid layout ([1437797](https://github.com/mcowger/plexus/commit/1437797)).
  - Fixed a pagination bug where string concatenation occurred instead of numeric addition ([91241d4](https://github.com/mcowger/plexus/commit/91241d4)).
  - Removed emojis from the interface ([1b07f6c](https://github.com/mcowger/plexus/commit/1b07f6c)).
  - Excluded assets from the build watch loop to improve performance ([12f065a](https://github.com/mcowger/plexus/commit/12f065a)).
- **Cleanup**:
  - Removed the unimplemented `/v1/responses` endpoint ([c79ef52](https://github.com/mcowger/plexus/commit/c79ef52)).
  - Stripped internal metadata from image generation responses ([e845a94](https://github.com/mcowger/plexus/commit/e845a94)).

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.12.0 - 2026-02-02

### v0.12.0: OpenAI-Compatible Image Generation and Editing APIs

### Main Features

- **Image Generation API**: Added OpenAI-compatible `/v1/images/generations` endpoint support
  - Create images from text prompts using any OpenAI-compatible image generation provider
  - Compatible with DALL-E 2, DALL-E 3, GPT Image models, Flux, and other providers
  - Supports multiple images per request (n parameter)
  - Configurable image sizes: 256x256, 512x512, 1024x1024, 1792x1024, 1024x1792
  - Response formats: url (valid 60 minutes) or b64_json
  - Quality control: standard, hd, high, medium, low (model dependent)
  - Style control for DALL-E 3: vivid or natural
  - Full usage tracking with costs and duration metrics
  - Pass-through optimization (no protocol transformation needed)

- **Image Editing API**: Added OpenAI-compatible `/v1/images/edits` endpoint support
  - Edit or extend images using text prompts
  - Single image upload support (PNG format, < 4MB)
  - Optional mask support for selective editing
  - Compatible with DALL-E 2 and GPT Image models
  - Supports multiple output images per request
  - Configurable image sizes and response formats
  - Full usage tracking with costs and duration metrics
  - Pass-through optimization (no protocol transformation needed)

- **Model Type System Extension**: Extended type field to support image models
  - Models can now be configured as `type: chat`, `type: embeddings`, `type: transcriptions`, `type: speech`, or `type: image`
  - Provider models support image type specification
  - Router automatically filters by model type when routing image requests
  - Ensures image models are only accessible via image APIs

- **UI Enhancements for Images**:
  - Added 'images' to known API types with fuchsia/magenta badge (#d946ef) in Providers page
  - Image type support in Models page Type column
  - Model Type dropdown includes image option in edit modals
  - Image icon for images in Logs page (fuchsia color)
  - Consistent badge styling across all pages

### Technical Implementation

- **New Transformer**: `ImageTransformer` class for request/response handling
  - Pass-through design for zero-overhead proxying
  - FormData handling for image edit multipart uploads
  - Support for both JSON and binary image responses

- **Unified Types**: Added comprehensive TypeScript types
  - `UnifiedImageGenerationRequest` / `UnifiedImageGenerationResponse`
  - `UnifiedImageEditRequest` / `UnifiedImageEditResponse`

- **Dispatcher Methods**: Added image-specific dispatch methods
  - `dispatchImageGenerations()` for POST /v1/images/generations
  - `dispatchImageEdits()` for POST /v1/images/edits

- **Route Handlers**: New inference routes
  - `POST /v1/images/generations` - Image generation endpoint
  - `POST /v1/images/edits` - Image editing endpoint (multipart/form-data)

- **Configuration Support**:
  - Added 'image' to model type enum in config schema
  - Updated API.md documentation with new endpoints
  - Updated CONFIGURATION.md with image model configuration examples

## v0.10.0 - 2026-02-02

### v0.10.0: Support for OpenAI-Compatible Audio APIs and Improved Persistence Logic

### Main New Features

* **Audio Speech (TTS) API Support**: Added support for OpenAI-compatible text-to-speech API endpoints. ([2b3025a](https://github.com/mcowger/plexus/commit/2b3025a))
* **Audio Transcriptions API Support**: Added support for OpenAI-compatible audio transcription API endpoints. ([62b019b](https://github.com/mcowger/plexus/commit/62b019b))

### Smaller Changes and Bug Fixes

* **UI Stability**: Added null checks for `request_id` fields in Error and Debug pages to prevent rendering issues. ([8d5bd01](https://github.com/mcowger/plexus/commit/8d5bd01))
* **Logging Control**: Prevented debug log persistence when the system is not in debug mode. ([93c3909](https://github.com/mcowger/plexus/commit/93c3909))
* **Embeddings Observability**: Added verbose debug logging for embeddings API requests. ([f9ba993](https://github.com/mcowger/plexus/commit/f9ba993))
* **Configuration Persistence**: Fixed a bug where the `enabled` field was not correctly saved for model alias targets. ([c132fc6](https://github.com/mcowger/plexus/commit/c132fc6))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.11.0 - 2026-02-02

### v0.11.0: OpenAI-Compatible Audio Speech Support

### Main Features

- **Audio Speech API**: Added OpenAI-compatible `/v1/audio/speech` endpoint support
  - Text-to-speech generation with support for multiple TTS models
  - Compatible with OpenAI TTS-1, TTS-1-HD, and GPT-4o-mini-tts models
  - Supports multiple voices: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin, cedar
  - Output formats: mp3, opus, aac, flac, wav, pcm (default: mp3)
  - Speed control (0.25x to 4.0x)
  - Voice instructions for style control (on supported models)
  - Streaming support via SSE format (`stream_format: "sse"`)
  - Full usage tracking with token counts, costs, and duration metrics
  - Pass-through optimization (no protocol transformation needed)

- **Model Type System Extension**: Extended type field to support speech models
  - Models can now be configured as `type: chat`, `type: embeddings`, `type: transcriptions`, or `type: speech`
  - Provider models support speech type specification
  - Router automatically filters by model type when routing speech requests
  - Ensures speech models are only accessible via speech API

- **UI Enhancements for Speech**:
  - Added speech to known API types with orange badge (#f97316) in Providers page
  - Speech type support in Models page Type column
  - Model Type dropdown includes speech option in edit modals
  - Volume2 icon for speech in Logs page (orange color)
  - Consistent badge styling across all pages

### Backend Implementation

- Created `SpeechTransformer` for request/response handling
- Added `dispatchSpeech()` method to Dispatcher service
- Implemented speech route handler with comprehensive validation
  - Input text validation (max 4096 characters)
  - Voice validation
  - Response format validation
  - Speed validation (0.25-4.0)
  - Streaming format validation
- Updated configuration schema to support `'speech'` model type

### Frontend Updates

- Updated `packages/frontend/src/pages/Providers.tsx` with speech badge
- Updated `packages/frontend/src/pages/Models.tsx` with type support
- Updated `packages/frontend/src/pages/Logs.tsx` with Volume2 icon
- Updated API types in `packages/frontend/src/lib/api.ts`

### Documentation

- Added `/v1/audio/speech` endpoint documentation to API.md
- Added speech model configuration examples to CONFIGURATION.md
- Updated README.md with speech endpoint listing

### Tests

- Added 15 comprehensive tests for SpeechTransformer
- Added 10 route handler tests for speech endpoint
- All tests passing

All existing backend tests continue to pass. Frontend builds successfully.

### v0.10.0: OpenAI-Compatible Audio Transcriptions Support

### Main Features

- **Audio Transcriptions API**: Added OpenAI-compatible `/v1/audio/transcriptions` endpoint support
  - Multipart/form-data file upload support (up to 25MB)
  - Compatible with OpenAI Whisper and GPT-4o transcription models
  - Supports multiple audio formats: mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
  - JSON and text response formats (additional formats coming in future versions)
  - Full usage tracking with token counts, costs, and duration metrics
  - Pass-through optimization (no protocol transformation needed)
  - Optional parameters: language, prompt, temperature

- **Model Type System Extension**: Extended type field to support transcriptions models
  - Models can now be configured as `type: chat`, `type: embeddings`, or `type: transcriptions`
  - Provider models support transcription type specification
  - Router automatically filters by model type when routing transcription requests
  - Ensures transcription models are only accessible via transcriptions API

- **UI Enhancements for Transcriptions**:
  - Added transcriptions to known API types with purple badge (#a855f7) in Providers page
  - Transcriptions type support in Models page Type column
  - Model Type dropdown includes transcriptions option in edit modals
  - AudioLines icon for transcriptions in Logs page (purple color)
  - Consistent badge styling across all pages

### Backend Implementation

- Installed `@fastify/multipart` plugin for multipart/form-data support
- Created `TranscriptionsTransformer` for request/response handling
- Added `dispatchTranscription()` method to Dispatcher service
- Implemented transcriptions route handler with comprehensive validation
  - File size validation (25MB limit)
  - MIME type validation
  - Response format validation (json, text)
- Updated configuration schema to support `'transcriptions'` model type

### Frontend Updates

- Updated `packages/frontend/src/pages/Providers.tsx` with transcriptions badge
- Updated `packages/frontend/src/pages/Models.tsx` with type support
- Updated `packages/frontend/src/pages/Logs.tsx` with AudioLines icon
- Updated API types in `packages/frontend/src/lib/api.ts`

### Documentation

- Added `/v1/audio/transcriptions` endpoint documentation to API.md
- Added transcriptions model configuration examples to CONFIGURATION.md
- Updated README.md with transcriptions endpoint listing

### Future Enhancements (Out of Scope for v1)

- Streaming support (SSE events)
- Additional response formats (srt, vtt, verbose_json, diarized_json)
- Advanced features (timestamp_granularities, speaker diarization)
- Duration-based pricing (currently using token-based approximation)

All 185 backend tests continue to pass. Frontend builds successfully.

## v0.9.0 - 2026-02-02

### v0.9.0: OpenAI-Compatible Embeddings Support, Drizzle ORM Migration, and Token Estimation Improvements

### New Features

- **Embeddings API Support**: Introduced OpenAI-compatible embeddings API support including full UI integration and passthrough request handling. ([7299ac1](https://github.com/mcowger/plexus/commit/7299ac1), [d516a75](https://github.com/mcowger/plexus/commit/d516a75), [a3ae36b](https://github.com/mcowger/plexus/commit/a3ae36b))
- **Token Estimation UI**: Added visual indicators for estimated token counts within the logs user interface. ([286aa35](https://github.com/mcowger/plexus/commit/286aa35))

### Improvements & Refactoring

- **Drizzle ORM Migration**: Refactored the data layer to migrate from `better-sqlite3` to Drizzle ORM for better schema management. ([6842d1a](https://github.com/mcowger/plexus/commit/6842d1a))
- **UsageStorageService**: Refactored to use dynamic schema loading and improved database connection handling. ([770e9c4](https://github.com/mcowger/plexus/commit/770e9c4))
- **OAuth Cooldowns**: Removed OAuth cooldown constraints. ([4bd3542](https://github.com/mcowger/plexus/commit/4bd3542))
- **Documentation & Configuration**: Updated documentation for the embeddings API, refined provider examples, and corrected example configuration structures. ([59db08f](https://github.com/mcowger/plexus/commit/59db08f), [bba6352](https://github.com/mcowger/plexus/commit/bba6352), [73e7c2f](https://github.com/mcowger/plexus/commit/73e7c2f), [ce77678](https://github.com/mcowger/plexus/commit/ce77678))

### Bug Fixes

- **Token Estimation**: Resolved failures in token estimation when debug mode is disabled and addressed usage estimation race conditions. ([c0ca4fa](https://github.com/mcowger/plexus/commit/c0ca4fa), [e9ed351](https://github.com/mcowger/plexus/commit/e9ed351), [8977aba](https://github.com/mcowger/plexus/commit/8977aba))
- **Docker Paths**: Fixed migration path resolution in Docker images using environment variables. ([f17118b](https://github.com/mcowger/plexus/commit/f17118b))
- **Maintenance**: Added database files to git ignore. ([4061438](https://github.com/mcowger/plexus/commit/4061438))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.9.0 - 2026-02-02

### v0.9.0: OpenAI-Compatible Embeddings API Support

### Main Features

- **Embeddings API**: Added full OpenAI-compatible `/v1/embeddings` endpoint support ([7299ac1](https://github.com/mcowger/plexus/commit/7299ac1))
  - Universal OpenAI embeddings format works with any provider (OpenAI, Voyage AI, Cohere, Google, etc.)
  - Full usage tracking with token counts, costs, and duration metrics
  - Authentication support (Bearer tokens and x-api-key headers)
  - Attribution tracking for fine-grained usage analytics
  - Pass-through optimization (no protocol transformation needed)

- **Model Type System**: Introduced `type` field to distinguish chat from embeddings models ([7299ac1](https://github.com/mcowger/plexus/commit/7299ac1))
  - Models can be configured as `type: chat` (default) or `type: embeddings`
  - Provider models support type specification in model configuration
  - Router automatically filters by model type when routing embeddings requests
  - Ensures embeddings models are only accessible via embeddings API

- **UI Enhancements for Embeddings**:
  - Added dedicated "Type" column in Models page showing chat/embeddings badges
  - Embeddings badge styling with green color (#10b981)
  - Model Type dropdown in both Models and Providers edit modals
  - Access Via checkboxes automatically hidden for embeddings models
  - Variable icon (lucide-react) for embeddings in Logs page
  - Improved API type badge spacing and consistency

### Backend Changes

- **New Components**:
  - `EmbeddingsTransformer`: Pass-through transformer for embeddings requests/responses
  - `dispatchEmbeddings()`: Dedicated dispatcher method for embeddings
  - Embeddings route with full usage tracking and cost calculation
  - 21 comprehensive tests covering transformer and route logic

- **Configuration Schema Updates**:
  - Added `type: 'chat' | 'embeddings'` to `ModelConfigSchema`
  - Added `type: 'chat' | 'embeddings'` to `ModelProviderConfigSchema`
  - Router filters targets by model type for embeddings requests

### Frontend Changes

- **Providers Page**:
  - Added 'embeddings' to known APIs with green badge
  - Model Type dropdown in provider model configuration
  - Smart UI hides API checkboxes for embeddings models
  - Shows info message for embeddings: "Embeddings models automatically use the 'embeddings' API only"

- **Models Page**:
  - Dedicated "Type" column displaying chat/embeddings badges
  - Model Type selector in alias edit modal
  - Type field persists correctly on save

- **Logs Page**:
  - Variable icon for embeddings API type (both incoming and outgoing)
  - Proper display of embeddings requests with pass-through mode

### Bug Fixes

- Fixed `outgoingApiType` not being set in embeddings usage records ([d516a75](https://github.com/mcowger/plexus/commit/d516a75))
- Fixed `isPassthrough` flag for embeddings requests ([d516a75](https://github.com/mcowger/plexus/commit/d516a75))
- Fixed saveAlias/getAliases to persist model type field
- Fixed API type badge spacing inconsistencies in Providers page

### Configuration Example

```yaml
providers:
  voyage:
    api_base_url: https://api.voyageai.com/v1
    api_key: ${VOYAGE_API_KEY}
    models:
      voyage-3:
        type: embeddings
        pricing:
          source: simple
          input: 0.00006
          output: 0

models:
  embeddings-model:
    type: embeddings
    selector: cost
    targets:
      - provider: openai
        model: text-embedding-3-small
      - provider: voyage
        model: voyage-3
```

All 185 backend tests passing ✓

---

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.8.5 - 2026-01-19

### v0.8.5: Bulk Model Import and Enhanced Provider Interface Capabilities

### New Features

- **Bulk Model Import**: Introduced functionality to bulk import models directly within the provider configuration ([a3c0d9a](https://github.com/mcowger/plexus/commit/a3c0d9a)).
- **Automated Model Addition**: Added a new model auto-add feature supporting search and multi-select UI patterns ([4c88193](https://github.com/mcowger/plexus/commit/4c88193)).
- **OpenRouter Slug Autocomplete**: Implemented substring-based search and autocomplete for OpenRouter model slugs ([2e816c9](https://github.com/mcowger/plexus/commit/2e816c9)).

### Minor Changes & Bug Fixes

- **Direct Model Access**: Refactored logic for direct model access patterns ([c5061be](https://github.com/mcowger/plexus/commit/c5061be)).
- **UI Enhancements**: Fetched models are now sorted alphabetically by their ID ([0e8b246](https://github.com/mcowger/plexus/commit/0e8b246)).
- **Testing Infrastructure**: Enhanced model testing routines with API-specific templates ([88d3634](https://github.com/mcowger/plexus/commit/88d3634)) and forced non-streaming modes for internal tests ([797b2f6](https://github.com/mcowger/plexus/commit/797b2f6)).
- **Stability Fixes**: Resolved test mock pollution by removing the global `PricingManager` mock ([5ee1c9b](https://github.com/mcowger/plexus/commit/5ee1c9b)) and corrected pricing source field validation in the provider UI ([daa6880](https://github.com/mcowger/plexus/commit/daa6880)).

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.8.0 - 2026-01-18

### v0.8.0: Direct Model Routing and Granular Cooldown Management

## Main Features

- **Direct Model Routing**: Implemented logic for direct routing of model requests. [[f165847](https://github.com/mcowger/plexus/commit/f165847)]
- **Per-Model Cooldowns**: Added support for configuring cooldown periods on a per-model basis to optimize resource allocation. [[45cddd8](https://github.com/mcowger/plexus/commit/45cddd8)]
- **OAuth Deprecation**: Refactored the codebase to remove OAuth-related components and legacy code. [[1b74438](https://github.com/mcowger/plexus/commit/1b74438)]

## Refinement and Performance

- **Performance Optimizations**: General performance enhancements throughout the system. [[ebc01a9](https://github.com/mcowger/plexus/commit/ebc01a9)]
- **Transformer Refactoring**: Internal architectural cleanup of the transformer modules. [[56db99b](https://github.com/mcowger/plexus/commit/56db99b)]
- **UI Improvements**:
    - Added drag handles for improved layout control. [[32d66be](https://github.com/mcowger/plexus/commit/32d66be)]
    - Reduced visual footprint of graphs and dialog boxes for higher density views. [[d5d7d88](https://github.com/mcowger/plexus/commit/d5d7d88), [4f2ef0d](https://github.com/mcowger/plexus/commit/4f2ef0d)]
    - Enhanced testing button visibility and functionality. [[268c1cc](https://github.com/mcowger/plexus/commit/268c1cc)]

## Bug Fixes and Stability

- **Database Initialization**: Resolved issues related to DB init sequences. [[ebd045f](https://github.com/mcowger/plexus/commit/ebd045f)]
- **Error Handling**: Improved error messaging and verbosity. [[9309971](https://github.com/mcowger/plexus/commit/9309971)]
- **Test Coverage**: Fixed various regression tests and CI stability issues. [[4d84b61](https://github.com/mcowger/plexus/commit/4d84b61)]

---

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.7.7 - 2026-01-08

### Release v0.7.7: OAuth Refresh Token Rotation

## v0.7.7 Release Notes \n **OAuth Refresh Token Rotation**: Added support for refresh token rotation to enhance security and session persistence. ([ee187f2](https://github.com/mcowger/plexus/commit/ee187f2))

## v0.7.6 - 2026-01-08

### Hotfix: Fix selector validation when using in-order selector

### New Features

- **Config Validation Notifications**: Added real-time validation error notifications to the Configuration page to improve user feedback ([169f46e](https://github.com/mcowger/plexus/commit/169f46e)).

### Bug Fixes and Improvements

- **Tokenization & Anthropic Integration**: Resolved issues with token overcounting and enhanced the imputation logic for Anthropic reasoning tokens ([4eec611](https://github.com/mcowger/plexus/commit/4eec611)).
- **Alias Validation Schema**: Integrated the `in_order` selector into the alias validation schema ([2fcb8e2](https://github.com/mcowger/plexus/commit/2fcb8e2)).
- **Testing Reliability**: Fixed mock pollution in `UsageInspector` tests to ensure isolated and reliable test runs ([5aafdc8](https://github.com/mcowger/plexus/commit/5aafdc8)).
- **Documentation**: Updated `CONFIGURATION.md` with latest configuration details ([0884ddf](https://github.com/mcowger/plexus/commit/0884ddf)).

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.7.5 - 2026-01-08

### Plexus v0.7.5: InOrder Selector, Usage Analytics, and Sidebar UI Refinement

## v0.7.5 Release Notes

### New Features
- **InOrder Selector**: Introduced a new `InOrder` selector to support prioritized provider fallback logic. ([fc913ab](https://github.com/mcowger/plexus/commit/fc913ab))
- **Usage Visualization**: Added interactive pie charts to provide usage breakdowns by model, provider, and API key. ([357cc8b](https://github.com/mcowger/plexus/commit/357cc8b))
- **Persistent Collapsible Sidebar**: Implemented a new sidebar with a persistent state across sessions for improved navigation. ([81bbecf](https://github.com/mcowger/plexus/commit/81bbecf))

### Minor Changes & Bug Fixes
- **Data Handling**: Fixed serialization and parsing for nested objects within Extra Body Fields and Custom Headers. ([435e43e](https://github.com/mcowger/plexus/commit/435e43e))
- **UI Normalization**: Standardized provider model arrays into object formats for consistent UI rendering. ([86e9071](https://github.com/mcowger/plexus/commit/86e9071))
- **Log Attribution**: Added attribution display to the key column within the logs table. ([70d7f34](https://github.com/mcowger/plexus/commit/70d7f34))
- **Layout Refinements**: 
    - Improved sidebar layout with a dedicated Main navigation section. ([aba668b](https://github.com/mcowger/plexus/commit/aba668b))
    - Reduced sidebar width to 200px and button padding to 8px for higher information density. ([e8bbade](https://github.com/mcowger/plexus/commit/e8bbade))
    - Refactored Debug Mode UI within the sidebar. ([00a6bc5](https://github.com/mcowger/plexus/commit/00a6bc5))
- **Chart Formatting**: Applied consistent number formatting across usage overview charts. ([232f5e9](https://github.com/mcowger/plexus/commit/232f5e9))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.7.1 - 2026-01-07

### v0.7.1: Manual OAuth Flow Implementation and Client Restriction Bypass

## Main Features

*   **Manual OAuth Flow**: Introduced a manual OAuth authentication method to circumvent environment-specific restrictions, specifically targeting limitations in Antigravity and Claude Code environments. ([19a7dd2](https://github.com/mcowger/plexus/commit/19a7dd2), [19c9835](https://github.com/mcowger/plexus/commit/19c9835), [4f2530b](https://github.com/mcowger/plexus/commit/4f2530b))

## Smaller Changes & Bug Fixes

*   **OAuth Logic Correction**: Resolved a bug that restricted OAuth options when an existing account was already configured in the system. ([8b1fe1d](https://github.com/mcowger/plexus/commit/8b1fe1d))
*   **URL Generation**: Fixed an issue with OAuth URL generation to ensure correct redirect behavior. ([469ce33](https://github.com/mcowger/plexus/commit/469ce33))
*   **Documentation**: General updates to the project documentation. ([8aea510](https://github.com/mcowger/plexus/commit/8aea510))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.7.0 - 2026-01-07

### v0.7.0: Claude Code OAuth Integration

### ✨ New Features

*   **Claude Code OAuth Integration:** Introduced the ability to authenticate with Claude Code using OAuth. This allows for seamless integration with Claude Code environments. ([cc89abe](https://github.com/mcowger/plexus/commit/cc89abe))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.6.6 - 2026-01-07

### v0.6.6: Corrected TPS Calculation and Documentation Updates

### Changes and Improvements

*   **Fix TPS Calculation:** Resolved an issue in the calculation logic for Transactions Per Second (TPS) to ensure accurate performance metrics. ([6375d96](https://github.com/mcowger/plexus/commit/6375d96))
*   **Documentation:** Updated the README to reflect recent project changes and instructions. ([6375d96](https://github.com/mcowger/plexus/commit/6375d96))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.6.5 - 2026-01-07

### v0.6.5: OAuth Multi-Account Scoping Fix and Logs UI Improvements

Introduce Multi-Oauth account balancing & Logs UI Improvements

## v0.6.0 - 2026-01-06

### v0.6.0: Google Antigravity Authentication Support

### New Features

- **Google Antigravity Integration**: Added support for Google Antigravity accounts ([b296521](https://github.com/mcowger/plexus/commit/b296521)).

---

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.5.2 - 2026-01-06

### Hotfix: Fix dispatcher when access_via[] is empty.

Hotfix: Fix dispatcher when access_via[] is empty.

## v0.5.1 - 2026-01-06

### v0.5.1 Release - Anthropic API Improvements and Enhanced Test Coverage

## What's New in v0.5.1

### Main Features

- **Anthropic API Support Improvements** - This release merges significant improvements to the Anthropic API implementation, enhancing how the system handles and transforms Anthropic API usage data. The changes improve the accuracy and reliability of usage inspection for Anthropic API calls. (https://github.com/mcowger/plexus/commit/aacee34)

### Other Changes

- **Test Coverage Expansion** - Added comprehensive tests for `UsageTransformer` and `AnthropicTransformer` functionality to ensure robust behavior and prevent regressions. (https://github.com/mcowger/plexus/commit/3cb8921)

---

**Docker Image Updated**: The latest release is available at `ghcr.io/mcowger/plexus:latest`

## v0.5.0 - 2026-01-06

### v0.5.0: Multi-Protocol API Routing, Provider/Model Management UI, and Gemini Integration

## Major Features

### Provider and Model Management UI
This release introduces full Provider and Model editing capabilities. Users can now manage AI providers and models directly through the web interface with an enhanced providers page that consolidates provider and model management ([47cd66d](https://github.com/mcowger/plexus/commit/47cd66d), [c2cf12c](https://github.com/mcowger/plexus/commit/c2cf12c), [cd8648d](https://github.com/mcowger/plexus/commit/cd8648d), [1b5d065](https://github.com/mcowger/plexus/commit/1b5d065)).

### Route Protection and Key Management
Inference routes are now protected, and a Key management UI has been added for better security and credential management ([5723029](https://github.com/mcowger/plexus/commit/5723029)).

### Multi-Protocol API Routing with Adaptive Matching
The API routing system has been significantly enhanced to support multiple protocols with adaptive matching, providing more flexible and intelligent request routing ([746ebc1](https://github.com/mcowger/plexus/commit/746ebc1)).

### Gemini Support
Added support for Google's Gemini AI models, expanding the range of supported providers ([2a8bc4e](https://github.com/mcowger/plexus/commit/2a8bc4e), [cbb6096](https://github.com/mcowger/plexus/commit/cbb6096)).

### Usage Tracking
Implemented comprehensive usage tracking to monitor API consumption and resource utilization ([cbb6096](https://github.com/mcowger/plexus/commit/cbb6096), [c51f4cb](https://github.com/mcowger/plexus/commit/c51f4cb)).

### Additional Aliases Support
Extended alias functionality to provide more flexible routing and endpoint naming ([f9b2005](https://github.com/mcowger/plexus/commit/f9b2005)).

### Fastify Migration
The application has been refactored to use Fastify as the web framework, improving performance and developer experience ([3fbb6fa](https://github.com/mcowger/plexus/commit/3fbb6fa)).

### Tailwind CSS Integration
Completely refactored the frontend styling with Tailwind CSS integration and updated build configurations ([c50c371](https://github.com/mcowger/plexus/commit/c50c371), [ce06349](https://github.com/mcowger/plexus/commit/ce06349)).

## Improvements and Fixes

### Core Improvements
- Refactored management routes for better organization ([3610d36](https://github.com/mcowger/plexus/commit/3610d36), [8f26846](https://github.com/mcowger/plexus/commit/8f26846))
- Streamlined OpenAI transformer and removed usage-extractors ([5974154](https://github.com/mcowger/plexus/commit/5974154))
- Simplified logging and response handling ([9838f54](https://github.com/mcowger/plexus/commit/9838f54))
- Fixed caching and Duration display ([b489333](https://github.com/mcowger/plexus/commit/b489333))

### Bug Fixes
- Fixed paths for compilation ([08490d9](https://github.com/mcowger/plexus/commit/08490d9))
- Improved mocking reliability ([9764306](https://github.com/mcowger/plexus/commit/9764306))
- Fixed mocks ([f1a7dca](https://github.com/mcowger/plexus/commit/f1a7dca))
- Fixed debouncing issues ([295594b](https://github.com/mcowger/plexus/commit/295594b))
- Fixed switch offset ([6bea944](https://github.com/mcowger/plexus/commit/6bea944))
- Fixed terminal escape codes ([4b0c194](https://github.com/mcowger/plexus/commit/4b0c194))
- Fixed debug logging ([ff18de2](https://github.com/mcowger/plexus/commit/ff18de2))

### Build and Testing
- Removed HAR file generation ([4af4e02](https://github.com/mcowger/plexus/commit/4af4e02))
- Updated build configurations ([c8585d6](https://github.com/mcowger/plexus/commit/c8585d6), [4e2a140](https://github.com/mcowger/plexus/commit/4e2a140))
- Fixed and simplified tests ([6b19516](https://github.com/mcowger/plexus/commit/6b19516), [5a8e477](https://github.com/mcowger/plexus/commit/5a8e477))
- Removed outdated test suites ([7f109e0](https://github.com/mcowger/plexus/commit/7f109e0))

### Cleanup and Maintenance
- General code cleanup ([d439f50](https://github.com/mcowger/plexus/commit/d439f50))
- Updated README documentation ([57f105a](https://github.com/mcowger/plexus/commit/57f105a))
- Updated dependency locks ([5974154](https://github.com/mcowger/plexus/commit/5974154))

---

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest

## v0.3.2 - 2026-01-04

### v0.3.2 - SSE Ping Events for Log Streaming

# Plexus Release v0.3.2

This release introduces Server-Sent Events (SSE) ping events to prevent timeouts during log streaming and for system logs.

## New Features

*   **SSE Ping Events for Log Streaming:** Implemented SSE ping events to maintain active connections and avoid timeouts when streaming logs. ([dff6abd](https://github.com/mcowger/plexus/commit/dff6abd))

## Smaller Changes

*   **Suppress Builds for Non-Code Changes:** Builds will now be suppressed if only non-code changes are detected. ([2f05172](https://github.com/mcowger/plexus/commit/2f05172))
*   **Release Script Prompt Updates:** Minor prompt updates in the release script for improved clarity. ([1d27dbf](https://github.com/mcowger/plexus/commit/1d27dbf))
*   **Release Script Updates:** General updates to the release script. ([3f2103a](https://github.com/mcowger/plexus/commit/3f2103a))

The docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest.

## v0.3.1 - 2026-01-04

### Update to re-add /v1/models endpoint lost in refactor

### 🚀 Main Features
- **Models API Testing Suite**: Introduced a comprehensive testing framework for the Models API, featuring precise timestamp verification (`eeca1cb`).
- **Developer Guidelines**: New documentation for testing best practices to ensure long-term code quality (`eeca1cb`).

### 🛠 Improvements & Fixes
- **API Restoration**: Fixed a critical issue where the `v1/models` endpoint was lost or inaccessible (`8e0ac0c`).
- **Test Isolation**: Significantly refactored the test suite to prevent module leakage and improve environmental isolation (`d413691`, `75dd497`, `8b00fea`).
- **Observability**: Added enhanced logging to facilitate easier debugging and monitoring (`94ff5ac`).
- **Tooling**: Implemented a new dev builder for streamlined local development (`58ca61f`).
- **Maintenance**: Cleaned up the repository by removing broken tests and applying general fixes to the test suite (`68bb84f`, `9ddfdec`, `e7d6369`).

## v0.3.0 - 2026-01-04

### Smooth Streams and Refined Stability

### Highlights

- **Improved Streaming Stability**: Addressed critical issues in the streaming interface to ensure a more reliable and consistent data flow ([5e4306b](https://github.com/example/repo/commit/5e4306b)).

### Minor Changes & Maintenance

- **Type Enhancements**: Applied several type fixes to improve code robustness and developer experience (`9ab12e6`).
- **Documentation**: Updated project documentation for better clarity and alignment with recent changes (`1b6bc5b`).
- **Housekeeping**: Refined project configuration by updating `.gitignore` (`c2b8c4c`).

## v0.2.5 - 2026-01-03

### Precision Performance: New Latency & Speed Selectors

### ✨ New Features
- **Performance & Latency Selectors:** Added powerful new selection capabilities to fine-tune system metrics and optimize for speed and response times.

### 🛠️ Improvements & Fixes
- **Configuration Updates:** Refined configuration logic to support the new performance parameters (`994c13c`).
- **Test Suite Enhancements:** Updated existing tests to ensure reliability across all new selector functionalities (`994c13c`).

## v0.2.2 - 2026-01-03

### Precision Performance: Smarter Metrics & Smoother Releases

### Key Improvements
- **Refined TPS Calculation**: Improved the accuracy of performance metrics by excluding input tokens from the Tokens Per Second (TPS) count, ensuring a more precise measurement of generation throughput.

### Minor Changes & Fixes
- Fix release automation scripts (`5d369d7`)
- Resolve logic in TPS counting metrics (`fabdf55`)
- Update internal testing suite in `test.ts` (`dd784c8`)

## 0.2.1 - 2026-01-03

### Precision Streams & Performance Insights

### 🚀 Key Features

- **Advanced Stream Management**: Implemented manual stream teeing to resolve locking issues and ensure safe chunk cloning for better data handling ([76fe496](https://github.com/example/repo/commit/76fe496)).
- **Real-time Performance Metrics**: Added comprehensive tracking for Time to First Token (TTFB) and Tokens per Second (T/S) to monitor system efficiency ([acbc281](https://github.com/example/repo/commit/acbc281), [4146ccf](https://github.com/example/repo/commit/4146ccf)).
- **Cost-Based Routing**: Introduced a new `CostSelector` and cost-based target selection logic for optimized resource allocation ([2ef1987](https://github.com/example/repo/commit/2ef1987)).
- **Multi-Stage Token Analysis**: Enhanced the token counting engine to support sophisticated multi-stage processing ([429782b](https://github.com/example/repo/commit/429782b)).

### 🛠 Minor Improvements & Fixes

- **Stream Robustness**: Enhanced debug logging and added automated cleanup with abort detection ([fdf2457](https://github.com/example/repo/commit/fdf2457)).
- **Connectivity**: Improved stability through better disconnect handling ([f599009](https://github.com/example/repo/commit/f599009)).
- **CI/CD**: Switched to using `CHANGELOG.md` for release notes generation ([258e9c4](https://github.com/example/repo/commit/258e9c4)).

## 0.2.0 - 2026-01-03

### Performance Unleashed: Smart Streams & Cost-Aware Routing

### 🚀 Main Features

- **Cost-Based Selection**: Introduced the `CostSelector` and target selection logic to optimize routing based on cost efficiency (`2ef1987`).
- **Advanced Stream Handling**: Implemented manual stream teeing to resolve locking issues and enable safe chunk cloning (`76fe496`).
- **Precision Performance Metrics**: Added comprehensive tracking for Time to First Byte (TTFB) and Tokens per Second (T/S) to monitor system health (`4146ccf`, `acbc281`).

### 🛠️ Smaller Changes & Improvements

- **Multi-Stage Token Counting**: Refined token counting logic with a new multi-stage approach (`429782b`).
- **Enhanced Stability**: Improved disconnect handling (`f599009`) and added stream auto-cleanup with abort detection (`fdf2457`).
- **CI/CD Optimization**: Switched to using `CHANGELOG.md` for release notes generation to ensure better documentation accuracy (`258e9c4`).
- **Debug Logging**: Enhanced logging capabilities for better stream observability (`fdf2457`).

## 0.2.0 - 2026-01-03

### Performance & Precision: Smart Routing and Stream Stability

### Main New Features

- **Advanced Stream Handling**: Implemented manual stream teeing and enhanced debug logging with auto-cleanup and abort detection. This ensures safe chunk cloning and prevents locking issues during heavy data transfer (`76fe496`, `fdf2457`).
- **Deep Performance Analytics**: Comprehensive tracking suite for performance metrics, including specific monitoring for Time to First Byte (TTFB) and Tokens per Second (T/S) (`4146ccf`, `acbc281`).
- **Cost-Based Routing**: Introduced the `CostSelector` and cost-based target selection logic to optimize resource utilization and efficiency (`2ef1987`).

### Minor Improvements

- **Multi-Stage Token Counting**: Updated the token counting logic to support multi-stage processing for higher accuracy (`429782b`).
- **Stability Enhancements**: Improved disconnect handling to ensure more resilient connections (`f599009`).

## v0.1.6 - 2026-01-03

### Fortified Foundations

### Main New Features

*   **Security Hardening**: Re-engineered the authentication middleware to strictly enforce API key requirements, ensuring a more robust security posture.

### Smaller Changes

*   Removed legacy testing bypasses in the auth layer to prevent unauthorized access in production-like environments (129e18b).

## v0.1.5 - 2026-01-02

### Smarter Response Flow

## What's New

This release focuses on refining the internal communication layer to improve data reliability.

### Minor Changes
- **Adjust response handling** (`dae0008`): Refined the logic for processing system responses to ensure more consistent data delivery.

## v0.1.4 - 2026-01-02

### 

## v0.1.3 - 2026-01-02

### Under-the-Hood Polish

### 🛠 Smaller Changes
- Performed minor script adjustments and maintenance. (`1512b09`)

## v0.1.2 - 2026-01-02

### Minor Release

Based on the provided commit log, here are the release notes:

### **Release Notes**

#### **Main New Features**
*   *No major user-facing features were introduced in this update.*

#### **Improvements & Bug Fixes**
*   **CI/CD Enhancements:** Updated the internal release script to improve the deployment process. ([d6c533e](d6c533e))

## v0.1.1 - 2026-01-02

### Add Live System Logs

Added live system logs so you dont need to drop into terminal or docker.

