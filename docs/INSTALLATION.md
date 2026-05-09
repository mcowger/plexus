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
  -v plexus-data:/app/data \
  -e ADMIN_KEY="your-admin-key" \
  -e DATABASE_URL=sqlite:///app/data/plexus.db \
  -e LOG_LEVEL=info \
  ghcr.io/mcowger/plexus:latest
```

-   Mount a volume to `/app/data` to persist usage logs, configuration, and other data.
-   `ADMIN_KEY` is required — set it to a secure password for accessing the admin dashboard and management API.
-   `DATABASE_URL` is required — set it to a `sqlite://` path (inside the mounted volume) or a `postgres://` connection string.
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
  -v plexus-data:/app/data \
  -e ADMIN_KEY="your-admin-key" \
  -e DATABASE_URL=sqlite:///app/data/plexus.db \
  -e LOG_LEVEL=info \
  plexus
```

## Standalone Binary

Plexus can be compiled into a single, self-contained binary that includes the Bun runtime, all backend logic, the pre-built frontend dashboard, and the database migration files.

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

The binary is fully self-contained: migration SQL files are embedded inside it at compile time, so no separate `drizzle/` directory or `DRIZZLE_MIGRATIONS_PATH` environment variable is needed when running the standalone binary.

### Running the Windows Standalone Binary

If `plexus.exe` opens and closes immediately, run it from a terminal so startup errors remain visible. `ADMIN_KEY` must be set before starting the server.

**Windows PowerShell:**
```powershell
$env:ADMIN_KEY = "your-admin-password"
$env:DATABASE_URL = "sqlite://./data/plexus.db"
.\plexus.exe
```

**Windows Command Prompt:**
```cmd
set ADMIN_KEY=your-admin-password
set DATABASE_URL=sqlite://./data/plexus.db
plexus.exe
```

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
   ADMIN_KEY="your-admin-key" DATABASE_URL=sqlite://./data/plexus.db bun run dev
   ```

## Environment Variables

When running Plexus, you can use the following environment variables to control its behavior:

- **`ADMIN_KEY`** (**Required**): Password for the admin dashboard and management API.
    - Must be set before starting the server. Server will refuse to start without it.
- **`DATABASE_URL`** (**Required**): Database connection string.
    - SQLite: `sqlite:///app/data/plexus.db` or `sqlite://./data/plexus.db`
    - PostgreSQL: `postgres://user:password@host:5432/dbname`
- **`ENCRYPTION_KEY`** (Optional): Encryption key for sensitive data at rest (API keys, OAuth tokens, provider credentials).
    - Generate with: `openssl rand -hex 32`
    - If not set, data is stored in plaintext. A warning is logged at startup.
    - See [Configuration: Encryption at Rest](CONFIGURATION.md#encryption-at-rest-optional) for details.
- **`LOG_LEVEL`**: The verbosity of the server logs.
    - Supported values: `error`, `warn`, `info`, `debug`, `silly`.
    - Default: `info`.
    - Note: `silly` logs all request/response/transformations.
    - Runtime override: You can change log level live via the management API/UI (`/v0/management/logging/level`). This override is ephemeral and resets on restart.
- **`PORT`** (Optional): HTTP server port. Default: `4000`
- **`HOST`** (Optional): Address to bind to. Default: `0.0.0.0`
- **`DATA_DIR`** (Optional): Directory for SQLite database. Default: `./data`

### Example Usage

```bash
ADMIN_KEY="your-secret" DATABASE_URL=sqlite://./data/plexus.db LOG_LEVEL=debug ./plexus
```

---

For configuration details, please refer to the [Configuration Guide](CONFIGURATION.md).