import { Context, Next } from 'hono';
import { logger } from '../utils/logger'; 

export const requestLogger = async (c: Context, next: Next) => {
    const { method, path } = c.req;

    if (method === 'GET' || method === 'POST') {
        logger.debug(`${method} ${path}`);
    } else {
        logger.info(`${method} ${path}`);
    }

    await next();
};