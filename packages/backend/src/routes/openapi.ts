import { FastifyInstance } from 'fastify';
import yaml from 'yaml';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Register the OpenAPI 3.1 spec endpoint.
 *
 * Serves the spec in both YAML and JSON formats at /v0/openapi.
 * This is intentionally registered outside the management auth scope
 * so it is publicly accessible for client SDK generation and docs.
 */
export async function registerOpenApiRoute(fastify: FastifyInstance) {
  // Lazy-load and cache the parsed spec
  let cachedSpec: Record<string, unknown> | null = null;

  function loadSpec(): Record<string, unknown> {
    if (cachedSpec) return cachedSpec;

    // Resolve the spec file relative to this source file's compiled location.
    // In dev:  packages/backend/src/routes/openapi.ts → src/openapi/spec.yaml
    // In dist: packages/backend/dist/routes/openapi.js → src/openapi/spec.yaml (via import.meta)
    const specPath = join(import.meta.dir, '..', '..', 'src', 'openapi', 'spec.yaml');
    const raw = readFileSync(specPath, 'utf-8');
    cachedSpec = yaml.parse(raw) as Record<string, unknown>;
    return cachedSpec!;
  }

  /**
   * GET /v0/openapi.yaml
   * Returns the raw OpenAPI 3.1 spec in YAML format.
   */
  fastify.get('/v0/openapi.yaml', async (_request, reply) => {
    const specPath = join(import.meta.dir, '..', '..', 'src', 'openapi', 'spec.yaml');
    const raw = readFileSync(specPath, 'utf-8');
    reply.type('text/yaml; charset=utf-8');
    return reply.send(raw);
  });

  /**
   * GET /v0/openapi.json
   * Returns the OpenAPI 3.1 spec in JSON format.
   */
  fastify.get('/v0/openapi.json', async (_request, reply) => {
    const spec = loadSpec();
    return reply.send(spec);
  });

  /**
   * GET /v0/openapi
   * Returns the OpenAPI 3.1 spec in JSON format (alias).
   */
  fastify.get('/v0/openapi', async (_request, reply) => {
    const spec = loadSpec();
    return reply.send(spec);
  });
}
