# Installation

Plexus can be run via Docker, as a standalone binary, or from source using Bun.

## Prerequisites

- **Bun**: Plexus is built with [Bun](https://bun.sh/). If you are running from source or building binaries, you will need Bun installed.

## Docker (Preferred)

The easiest way to run Plexus is using the pre-built Docker image.

**Pull the image:**
```bash
docker pull ghcr.io/mcowger/plexus:latest
```

**Run the container:**
```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  -e LOG_LEVEL=info \
  ghcr.io/mcowger/plexus:latest
```

-   Mount your configuration file to `/app/config/plexus.yaml`.
-   Mount a volume to `/app/data` to persist usage logs and other data.
-   Set `LOG_LEVEL` to control verbosity.

## Building the Docker Image

If you want to build the image yourself:

**Build the image:**
```bash
docker build -t plexus .
```

**Run the container:**
```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  -e LOG_LEVEL=info \
  plexus
```

## Standalone Binary

Plexus can be compiled into a single, self-contained binary that includes the Bun runtime, all backend logic, and the pre-built frontend dashboard.

### Build Commands

1. **Clone the repository**:
   ```bash
   git clone https://github.com/mcowger/plexus.git
   cd plexus
   ```

2. **Install dependencies**:
   ```bash
   bun run install:all
   ```

3. **Compile**:
   - **macOS (ARM64/Apple Silicon):** `bun run compile:macos`
   - **Linux (x64):** `bun run compile:linux`
   - **Windows (x64):** `bun run compile:windows`

The resulting executable will be named `plexus-macos` (or `plexus-linux` / `plexus.exe`) in the project root.

## Running from Source

1. **Clone the repository**:
   ```bash
   git clone https://github.com/mcowger/plexus.git
   cd plexus
   ```

2. **Install dependencies**:
   ```bash
   bun run install:all
   ```

3. **Start Development Stack**:
   ```bash
   bun run dev
   ```

## Environment Variables

When running Plexus, you can use the following environment variables to control its behavior:

- **`CONFIG_FILE`**: Path to the `plexus.yaml` configuration file.
    - Default: `config/plexus.yaml` (relative to project root).
- **`DATA_DIR`**: Directory where Plexus stores its SQLite database (`usage.sqlite`) for logs and cooldowns.
    - Default: Falls back to the directory containing your configuration file, or a `data/` directory in the current working directory.
- **`LOG_LEVEL`**: The verbosity of the server logs.
    - Supported values: `error`, `warn`, `info`, `debug`, `silly`.
    - Default: `info`.
    - Note: `silly` logs all request/response/transformations.
    - Runtime override: You can change log level live via the management API/UI (`/v0/management/logging/level`). This override is ephemeral and resets on restart.

### Example Usage

```bash
CONFIG_FILE=./my-config.yaml DATA_DIR=./data LOG_LEVEL=debug ./plexus
```

---

For configuration details, please refer to the [Configuration Guide](CONFIGURATION.md).
