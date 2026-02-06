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

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Build the frontend and compile the backend into a single binary
# This script runs 'bun run build:frontend' and then 'bun build ... --compile ...'
RUN bun run compile:linux

# Stage 2: Create the production image - use debian for debug
FROM debian:bookworm-slim

# Set the working directory to /app/backend so that relative paths like "../frontend/dist" work as expected
WORKDIR /app/backend

# Install bash for debugging
RUN apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from the builder stage
COPY --from=builder /app/plexus-linux ./plexus

# Copy drizzle migrations (required for database migrations)
COPY --from=builder /app/packages/backend/drizzle/migrations ./packages/backend/drizzle/migrations
COPY --from=builder /app/packages/backend/drizzle/migrations_pg ./packages/backend/drizzle/migrations_pg
COPY --from=builder /app/packages/backend/drizzle/schema ./packages/backend/drizzle/schema

# Copy the frontend assets to the location expected by the backend ("../frontend/dist")
COPY --from=builder /app/packages/frontend/dist /app/frontend/dist

# Environment variables
ENV LOG_LEVEL=info
ENV DATA_DIR=/app/data
ENV CONFIG_FILE=/app/config/plexus.yaml
ENV DRIZZLE_MIGRATIONS_PATH=/app/backend/packages/backend/drizzle/migrations_pg

# Run the application
CMD ["./plexus"]
