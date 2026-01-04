# Changelog

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

