# Project Overview

This is a full-stack monorepo project that consists of a React frontend and a Hono backend. The project is managed using pnpm workspaces.

- **Frontend:** A React application built with Vite. It fetches data from the backend and displays it.
- **Backend:** A Hono server that serves the frontend and provides a simple API.
- **Types:** A shared package for TypeScript types used by both the frontend and backend.

## Building and Running

### Prerequisites

- [pnpm](https://pnpm.io/installation)

### Installation

```bash
pnpm install
```

### Development

To run both the frontend and backend in development mode with hot-reloading:

```bash
pnpm dev
```

The frontend will be available at `http://localhost:5173` and the backend at `http://localhost:3000`.

### Build

To build all packages for production:

```bash
pnpm build
```

### Running in Production

After building the project, you can start the backend server:

```bash
pnpm --filter @plexus/backend start
```

The application will be available at `http://localhost:3000`.

## Development Conventions

### Monorepo Structure

The project is a monorepo with the following structure:

- `packages/frontend`: The React frontend application.
- `packages/backend`: The Hono backend server.
- `packages/types`: Shared TypeScript types.

### Scripts

- `pnpm dev`: Starts the development servers for all packages.
- `pnpm build`: Builds all packages.
- `pnpm --filter <package-name> <script>`: Runs a script for a specific package (e.g., `pnpm --filter @plexus/frontend lint`).

### Logging

All logging in the backend must use the singleton logger located at `packages/backend/src/utils/logger.ts`.

**Do not use `console.log()`, `console.error()`, or other console methods directly.**

#### Usage

Import the logger in any backend file:

```typescript
import { logger } from "./utils/logger.js";
```

#### Log Levels

Use the appropriate log level based on the message type:

- `logger.debug()`: Detailed debugging information for development
- `logger.info()`: General informational messages (e.g., server status, configuration loaded)
- `logger.warn()`: Warning messages for potentially problematic situations
- `logger.error()`: Error messages for errors and exceptions

#### Features

The logger uses Winston with the following features:

- **Singleton pattern**: ensures one logger instance across the entire backend
- **Debug level**: default logging level for development
- **Colorization**: extensive color coding for different log levels and output
- **Clear formatting**: includes timestamps and support for metadata
- **Console transport**: routes messages to console methods instead of stdout/stderr (useful for debugging tools)

#### Examples

```typescript
// Informational messages
logger.info("Server started successfully");
logger.info(`Loaded ${configSnapshot.providers.size} providers`);

// Debug messages (useful during development)
logger.debug(`${c.req.method} ${c.req.path}`);

// Warning messages
logger.warn('Provider configuration file not found, using empty configuration');
logger.warn(`Failed to transform model ${modelName}:`, error);

// Error messages
logger.error("Failed to initialize application:", error);
logger.error("Unhandled error:", err);
```


## Sample Code

Code from other applications that might be useful as references is kept in sample_code.  It can never e used unchanged, not should be compiled and considered a source of truth.  However, it may be useful as a reference.