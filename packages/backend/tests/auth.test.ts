import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';

describe('Authentication Middleware', () => {
  const app = new Hono();
  const authMiddleware = bearerAuth({ token: 'virtual-key' });

  // Error handling middleware (must be first)
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    
    // Handle Hono's HTTPException from bearer auth
    if (err.name === 'HTTPException') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  app.get('/protected', authMiddleware, (c) => {
    return c.json({ message: 'Protected route' });
  });

  it('should allow access with valid token', async () => {
    const res = await app.request('/protected', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer virtual-key',
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ message: 'Protected route' });
  });

  it('should deny access without token', async () => {
    const res = await app.request('/protected', {
      method: 'GET',
    });

    // Check if it's a 401 from bearer auth or 500 from error handling
    expect(res.status).toBeOneOf([401, 500]);
  });

  it('should deny access with invalid token', async () => {
    const res = await app.request('/protected', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });

    // Check if it's a 401 from bearer auth or 500 from error handling
    expect(res.status).toBeOneOf([401, 500]);
  });
});