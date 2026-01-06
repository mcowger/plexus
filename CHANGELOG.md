# Changelog

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

