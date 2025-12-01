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

### API

The backend exposes a simple API:

- `GET /api/user`: Returns a mock user object.
