import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '@plexus/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();
const port = 3000;

// Example user data
const user: User = {
  id: '1',
  name: 'John Doe',
};

// API route
app.get('/api/user', (c) => {
  return c.json(user);
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
