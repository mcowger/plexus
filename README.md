# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) under a single API. Switch models and providers without rewriting client code.

### Recent Updates (v0.9.0)

- **Embeddings API**: Full OpenAI-compatible `/v1/embeddings` endpoint support
- **Model Type System**: Distinguish between chat and embeddings models with automatic API filtering
- **Token Estimation**: Automatic token counting for providers that don't return usage data
- **Bulk Model Import**: Import models directly in provider configuration
- **Direct Model Routing**: Route directly to provider models with `direct/provider/model` format

### Database & ORM

Plexus uses **Drizzle ORM** with **SQLite** for data persistence:

- **Schema Management**: Type-safe database schemas in `packages/backend/drizzle/schema/`
- **Automatic Migrations**: Migrations run automatically on startup
- **Tables**: Usage tracking, provider cooldowns, debug logs, inference errors, performance metrics

#### Managing Database Schema

**Generate a migration after schema changes:**
```bash
cd packages/backend
bunx drizzle-kit generate
```

**Apply migrations manually (optional):**
```bash
bunx drizzle-kit migrate
```

**Creating a new table:**
```typescript
// In drizzle/schema/new-table.ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const newTable = sqliteTable('new_table', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});
```

Then run `bunx drizzle-kit generate` to create the migration.

## Quick Start

```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest
```

See [Installation Guide](docs/INSTALLATION.md) for other options.

## License

MIT License - see LICENSE file.
