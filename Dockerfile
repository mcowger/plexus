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
# Use TARGETPLATFORM to select the correct build target (e.g., linux/amd64, linux/arm64).
# BuildKit sets this automatically; deploy-staging.ts also passes it explicitly as --build-arg.
RUN case "${TARGETPLATFORM}" in \
         linux/arm64) bun run compile:linux-arm64 && mv plexus-linux-arm64 plexus ;; \
         linux/amd64) bun run compile:linux-amd64 && mv plexus-linux-amd64 plexus ;; \
         *) echo "Unsupported platform: ${TARGETPLATFORM}" && exit 1 ;; \
    esac

# Stage 2: Production image with local MCP runtime tooling.
# Includes Bun/bunx and uv/uvx so Plexus can manage local HTTP MCP servers.
FROM oven/bun:1

WORKDIR /app

# Install local MCP runtime tooling (uv/uvx for Python MCP servers).
# IMPORTANT: This RUN must stay ABOVE any ARG/ENV for APP_VERSION. BuildKit
# invalidates the cache of a RUN instruction whenever an in-scope ARG changes
# value — even if the ARG is not referenced in that RUN. Since APP_VERSION
# changes on every release, declaring it before this layer would re-run the
# full apt-get + uv install on every build. Keeping it after lets this layer
# cache stably across all version tags.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git python3 build-essential \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -sf /root/.local/bin/uv /usr/local/bin/uv \
    && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from the builder stage.
COPY --from=builder /app/plexus ./plexus

EXPOSE 4000

# Environment variables
ENV PORT=4000
ENV LOG_LEVEL=info
ENV DATA_DIR=/app/data
ENV DATABASE_URL=sqlite:///app/data/plexus.db
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
# ADMIN_KEY must be provided at runtime (no default for security)

CMD ["./plexus"]
