import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

describe('Request Validation', () => {
  const testSchema = z.object({
    name: z.string().min(1),
    age: z.number().min(0),
  });

  const app = new Hono();

  // Error handling middleware (must be first)
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    
    // Handle Zod validation errors
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.issues }, 400);
    }
    
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  app.post('/test', zValidator('json', testSchema), (c) => {
    const data = c.req.valid('json');
    return c.json({ message: 'Valid data', data });
  });

  it('should accept valid request body', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'John Doe',
        age: 30,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toEqual({ name: 'John Doe', age: 30 });
  });

  
});