# Stage 1: Build the application
FROM oven/bun:1 AS builder

WORKDIR /app

ARG APP_VERSION=dev
ARG TARGETPLATFORM
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
# Use BuildKit's TARGETPLATFORM to select the correct build target (e.g., linux/amd64, linux/arm64)
RUN case "${TARGETPLATFORM}" in \
         linux/arm64) bun run compile:linux-arm64 ;; \
         linux/amd64) bun run compile:linux-amd64 ;; \
         *) echo "Unsupported platform: ${TARGETPLATFORM}" && exit 1 ;; \
    esac

# Stage 2: Minimal production image — just the binary
FROM debian:bookworm-slim

ARG APP_VERSION=dev
ARG TARGETPLATFORM

WORKDIR /app

# Copy the compiled binary from the builder stage (uses BuildKit's TARGETPLATFORM)
COPY --from=builder /app/plexus-linux-${TARGETPLATFORM#linux/} ./plexus

EXPOSE 4000

# Environment variables
ENV PORT=4000
ENV LOG_LEVEL=info
ENV DATA_DIR=/app/data
ENV DATABASE_URL=sqlite:///app/data/plexus.db
ENV APP_VERSION=${APP_VERSION}
# ADMIN_KEY must be provided at runtime (no default for security)

CMD ["./plexus"]
