# Changelog

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

