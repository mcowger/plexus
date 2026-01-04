import winston from 'winston';
import Transport from 'winston-transport';
import { EventEmitter } from 'events';

const { combine, timestamp, printf, colorize, splat, json } = winston.format;


// Event emitter for streaming logs
export const logEmitter = new EventEmitter();

// Custom transport to emit logs
export class StreamTransport extends Transport {
  override log(info: any, callback: () => void) {
    setImmediate(() => {
      logEmitter.emit('log', info);
    });
    callback();
  }
}


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
