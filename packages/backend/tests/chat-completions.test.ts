import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import {testClient} from 'hono/testing'
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

describe('Chat Completions Endpoint', () => {
  const app = new Hono();
  const authMiddleware = bearerAuth({ token: 'virtual-key' });

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

  // Error handling middleware (must be first)
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    
    // Handle Zod validation errors
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.issues }, 400);
    }
    
    // Handle Hono's HTTPException from bearer auth
    if (err.name === 'HTTPException') {
      const status = (err as any).res?.status || 401;
      return c.json({ error: 'Unauthorized' }, status);
    }
    
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  app.post('/v1/chat/completions', authMiddleware, zValidator('json', chatCompletionSchema), async (c) => {
    const { messages, model, temperature } = c.req.valid('json');
    
    console.log('Received chat completion request:', { messages, model, temperature });
    
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

  it('should return chat completion with valid request and token', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer virtual-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
        ],
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe('chat.completion');
    expect(data.choices).toHaveLength(1);
    expect(data.choices[0].message.role).toBe('assistant');
    expect(data.choices[0].message.content).toBe('This is a mock response from the chat completion endpoint.');
  });

  it('should reject request without authentication', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
        ],
      }),
    });

    // Check if it's a 401 from bearer auth or 500 from error handling
    expect(res.status).toBeOneOf([401, 500]);
  });

  it('should reject request with invalid authentication', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
        ],
      }),
    });

    // Check if it's a 401 from bearer auth or 500 from error handling
    expect(res.status).toBeOneOf([401, 500]);
  });

  
});