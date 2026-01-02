import winston from 'winston';
import { logEmitter, StreamTransport } from './log-base';

// Re-export logEmitter and StreamTransport
export { logEmitter, StreamTransport };

const { combine, timestamp, printf, colorize, splat, json } = winston.format;

// Define custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  // Check if there are metadata/objects to print
  if (Object.keys(metadata).length > 0) {
    // If the metadata contains 'splat' (from util.format style args), handle it?
    // Winston's splat format puts extra args into metadata.
    // We want to pretty print them.
    msg += ` ${JSON.stringify(metadata, null, 2)}`;
  }
  return msg;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  // Default format
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    splat(),
    json() // Default to JSON for structural integrity if not overridden by transport
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        splat(),
        consoleFormat
      ),
    }),
    new StreamTransport()
  ],
});
