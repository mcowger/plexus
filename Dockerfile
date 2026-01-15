# Dockerfile for Plexus2 - Linux x64
# Build with: docker buildx build --platform linux/amd64 -t plexus2:latest --push .

FROM oven/bun:latest AS builder

WORKDIR /app

# Copy workspace configuration and source code
COPY package.json .
COPY bun.lock .
COPY tsconfig.json .
COPY bunfig.toml .

# Install dependencies early to leverage caching
RUN bun install --frozen-lockfile --no-progress

COPY server/ server/
COPY src/ src/
COPY index.ts .
COPY server.ts .

# Compile for Linux x64
RUN bun run compile:linux

# Create data directory in builder stage
RUN mkdir -p /app/data
# Create config directory in builder stage
RUN mkdir -p /app/config

# Runtime stage - distroless
FROM oven/bun:distroless

WORKDIR /app
# Copy the compiled binary from builder
COPY --from=builder /app/dist/plexus2-linux-x64 /app/plexus2

# Copy data directory from builder
COPY --from=builder /app/data /app/data
COPY --from=builder /app/config /app/config

# Volume mounts
VOLUME ["/app/config", "/app/data"]

# Expose port
EXPOSE 4000

# Run the application
ENTRYPOINT ["/app/plexus2", "--config", "/app/config/plexus.yaml"]
CMD []
