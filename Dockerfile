# Stage 1: Build the application
FROM oven/bun:1 AS builder

WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Copy root package files
COPY package.json bun.lock ./

# Copy package-specific package.json files
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/shared/package.json ./packages/shared/

# Copy scripts needed by the prepare hook
COPY scripts/ ./scripts/

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts

# Copy the rest of the source code
COPY . .

# Build the frontend and compile everything into a single self-contained binary.
# Frontend assets (HTML, JS, CSS, images) and migration SQL files are all embedded
# inside the binary via `bun build --compile` — no runtime file copies needed.
RUN bun run compile:linux

# Stage 2: Minimal production image — just the binary
FROM debian:bookworm-slim

WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /app/plexus-linux ./plexus

EXPOSE 4000

# Environment variables
ENV PORT=4000
ENV LOG_LEVEL=info
ENV DATA_DIR=/app/data
ENV DATABASE_URL=sqlite:///app/data/plexus.db
ENV CONFIG_FILE=/app/config/plexus.yaml
# ADMIN_KEY must be provided at runtime (no default for security)

CMD ["./plexus"]
