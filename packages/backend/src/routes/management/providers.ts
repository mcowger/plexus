import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logger } from '../../utils/logger';

const fetchModelsSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().optional(),
});

/**
 * Validates that a URL is safe to fetch from (SSRF protection).
 * Blocks dangerous protocols and critical internal addresses.
 * Allows private networks (trusted admin model for Ollama, etc.).
 */
function validateUrlSafety(url: string): { valid: boolean; error?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http and https protocols
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, error: 'Only http and https URLs are allowed' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Block localhost (server itself)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return { valid: false, error: 'Cannot fetch from localhost' };
  }

  // Block cloud metadata endpoints (AWS IMDS, GCP, Azure)
  // This prevents credential theft in cloud environments
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.azure.internal'
  ) {
    return { valid: false, error: 'Cannot fetch from cloud metadata endpoints' };
  }

  // Private networks are allowed (trusted admin model)
  // Admins may use Ollama or other services on private networks
  logger.debug(`[providers] Fetch request to: ${hostname}`);

  return { valid: true };
}

/**
 * Converts Ollama-style response { models: [...] } to OpenAI-style { data: [...] }
 */
function normalizeModelsResponse(data: any): { data: any[] } {
  // Already OpenAI-style
  if (data && Array.isArray(data.data)) {
    return { data: data.data };
  }

  // Ollama-style: { models: [...] }
  if (data && Array.isArray(data.models)) {
    // Convert Ollama model format to OpenAI-style
    const convertedModels = data.models.map((model: any) => {
      // Ollama returns { name, modified_at, size, digest, details }
      // Transform to OpenAI-style { id, object, created, owned_by }
      if (typeof model === 'string') {
        return { id: model, object: 'model', created: Date.now(), owned_by: 'ollama' };
      }
      return {
        id: model.name || model.id || model.model,
        object: 'model',
        created: model.modified_at
          ? new Date(model.modified_at).getTime() / 1000
          : Date.now() / 1000,
        owned_by: 'ollama',
        // Preserve additional fields
        ...model,
      };
    });
    return { data: convertedModels };
  }

  // Unknown format - wrap in data array
  if (data && !data.data && !data.models) {
    logger.warn('[providers] Unknown models response format, wrapping in data array');
    return { data: [data] };
  }

  return { data: [] };
}

export async function registerProviderRoutes(fastify: FastifyInstance) {
  fastify.post('/v0/management/providers/fetch-models', async (request, reply) => {
    const parsed = fetchModelsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          message: 'Invalid request body',
          type: 'validation_error',
          code: 400,
          details: parsed.error.errors,
        },
      });
    }

    const { url, apiKey } = parsed.data;

    // SSRF protection
    const urlValidation = validateUrlSafety(url);
    if (!urlValidation.valid) {
      return reply.code(400).send({
        error: {
          message: urlValidation.error || 'Invalid URL',
          type: 'ssrf_blocked',
          code: 400,
        },
      });
    }

    try {
      // Build request headers
      const requestHeaders: Record<string, string> = {
        Accept: 'application/json',
      };

      // Add Authorization header if apiKey provided
      if (apiKey) {
        requestHeaders['Authorization'] = `Bearer ${apiKey}`;
      }

      logger.debug(`[providers] Fetching models from ${url}`);

      // Make the fetch request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: requestHeaders,
          signal: controller.signal,
          redirect: 'manual',
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          logger.error(`[providers] Fetch failed: ${response.status} ${response.statusText}`);
          return reply.code(response.status).send({
            error: {
              message: `Provider returned ${response.status}: ${response.statusText}`,
              type: 'provider_error',
              code: response.status,
              details: errorText.substring(0, 500),
            },
          });
        }

        const data = await response.json();

        // Normalize response format (handles both OpenAI and Ollama)
        const normalized = normalizeModelsResponse(data);

        logger.debug(`[providers] Fetched ${normalized.data.length} models from ${url}`);
        return reply.send(normalized);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          logger.error(`[providers] Request timeout for ${url}`);
          return reply.code(504).send({
            error: {
              message: 'Request timed out after 10 seconds',
              type: 'timeout_error',
              code: 504,
            },
          });
        }
        logger.error(`[providers] Fetch error: ${error.message}`);
        return reply.code(500).send({
          error: {
            message: error.message,
            type: 'fetch_error',
            code: 500,
          },
        });
      }
      logger.error('[providers] Unknown fetch error', error);
      return reply.code(500).send({
        error: {
          message: 'An unexpected error occurred',
          type: 'internal_error',
          code: 500,
        },
      });
    }
  });
}
