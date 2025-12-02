import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { bearerAuth } from 'hono/bearer-auth';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  chatCompletionSchema, 
  VirtualKeyConfig, 
  ProviderType 
} from '@plexus/types';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { RoutingEngine } from './routing/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();
const port = 3000;

// Initialize routing engine with virtual key configurations
const virtualKeys = new Map<string, VirtualKeyConfig>([
  ['virtual-key', {
    key: 'virtual-key',
    provider: 'openai' as ProviderType,
    model: 'gpt-3.5-turbo',
    priority: 1,
    fallbackProviders: ['anthropic', 'openrouter']
  }]
]);

const routingConfig = {
  virtualKeys,
  healthCheckInterval: 60000, // 1 minute
  retryPolicy: {
    maxRetries: 3,
    backoffMultiplier: 2,
    initialDelay: 100,
    maxDelay: 1000,
    retryableErrors: ['timeout', 'rate_limit', 'network_error']
  },
  fallbackEnabled: true
};

const routingEngine = new RoutingEngine(routingConfig);

// Error handling middleware (must be first)
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  
  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    return c.json({ error: 'Invalid request', details: err.issues }, 400);
  }
  
  // Handle Hono's HTTPException from bearer auth
  if (err.name === 'HTTPException') {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Basic logging middleware
app.use('*', async (c, next) => {
  console.log(`${c.req.method} ${c.req.path}`);
  await next();
});

// Authentication middleware for /v1/chat/completions
const authMiddleware = bearerAuth({ token: 'virtual-key' });

// Chat Completion Endpoint
app.post('/v1/chat/completions', authMiddleware, zValidator('json', chatCompletionSchema), async (c) => {
  const { messages, model, temperature } = c.req.valid('json');
  
  // Get virtual key from authentication token
  const virtualKey = c.req.header('authorization')?.replace('Bearer ', '') || 'virtual-key';
  
  try {
    // Route the request through the provider system
    const routingResponse = await routingEngine.routeRequest({
      virtualKey,
      request: {
        messages,
        model,
        temperature
      },
      userId: 'anonymous', // In a real app, you'd get this from auth
      metadata: {
        timestamp: new Date().toISOString(),
        userAgent: c.req.header('user-agent'),
      }
    });

    // Return the provider response
    return c.json(routingResponse.response);
  } catch (error) {
    console.error('Chat completion error:', error);
    
    // Return error response
    return c.json({
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'provider_error',
        code: 'ROUTING_FAILED'
      }
    }, 500);
  }
});

// Health check endpoint
app.get('/health', async (c) => {
  try {
    const providerStatus = routingEngine.getProviderStatus();
    const healthScores = routingEngine.getHealthScores();
    
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      providers: Object.fromEntries(providerStatus),
      healthScores: Object.fromEntries(healthScores)
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Provider status endpoint
app.get('/api/providers/status', async (c) => {
  try {
    const providerStatus = routingEngine.getProviderStatus();
    const healthScores = routingEngine.getHealthScores();
    
    return c.json({
      providers: Object.fromEntries(providerStatus),
      healthScores: Object.fromEntries(healthScores),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get provider status',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Serve frontend
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use('/*', serveStatic({ root: frontendPath }));
app.get('/*', serveStatic({ path: path.join(frontendPath, 'index.html') }));

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server is running on http://localhost:${port}`);
