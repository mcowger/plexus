import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { bearerAuth } from 'hono/bearer-auth';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '@plexus/types';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();
const port = 3000;

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

// Example user data
const user: User = {
  id: '1',
  name: 'John Doe',
};

// API route
app.get('/api/user', (c) => {
  return c.json(user);
});

// Authentication middleware for /v1/chat/completions
const authMiddleware = bearerAuth({ token: 'virtual-key' });

// Chat Completion Endpoint
const chatCompletionSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  model: z.string().optional(),
  temperature: z.number().optional(),
});

app.post('/v1/chat/completions', authMiddleware, zValidator('json', chatCompletionSchema), async (c) => {
  const { messages, model, temperature } = c.req.valid('json');
  
  // Process the chat completion request
  console.log('Received chat completion request:', { messages, model, temperature });
  
  // Return a mock response
  return c.json({
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'gpt-3.5-turbo',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'This is a mock response from the chat completion endpoint.',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  });
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
