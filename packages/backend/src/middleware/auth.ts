import { bearerAuth } from 'hono/bearer-auth';
import { Context, Next } from 'hono';
// Adjust this import path to where your getConfig is located
import { getConfig } from '../config'; 
import {KeyConfig} from '../config'

export const customAuth = async (c: Context, next: Next) => {
  // 1. Path Whitelisting
  if (c.req.path === '/v1/models') {
    return await next();
  }

  // 2. Configuration Safety Check
  const config = getConfig();
  const keys: KeyConfig[] = config.keys ? Object.values(config.keys) : [];
  if (!keys || keys.length === 0) {
    return c.json(
      { 
        error: { 
          message: "Unauthorized: No API keys configured", 
          type: "auth_error" 
        } 
      }, 
      401
    );
  }

  // 3. Dynamic Token Verification
  const auth = bearerAuth({
    verifyToken: async (token) => {
      const currentConfig = getConfig();
      const keys: KeyConfig[] = currentConfig.keys ? Object.values(currentConfig.keys) : [];
      return keys.some(k => k.secret === token);
    },
  });

  return await auth(c, next);
};