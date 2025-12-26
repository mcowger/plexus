import winston from 'winston';

/**
 * Singleton Logger class using Winston.
 * Provides colorized, formatted logging with configurable levels.
 */
class Logger {
  private static instance: winston.Logger;

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  /**
   * Get the singleton logger instance
   */
  public static getInstance(): winston.Logger {
    if (!Logger.instance) {
      Logger.instance = winston.createLogger({
        level: 'debug',
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.splat(),
          winston.format.printf(({ timestamp, level, message, ...metadata }) => {
            let msg = `${timestamp} [${level}]: ${message}`;
            
            // Add metadata if present
            if (Object.keys(metadata).length > 0) {
              // Remove known winston properties
              const { level: _level, message: _message, timestamp: _timestamp, ...rest } = metadata as any;
              if (Object.keys(rest).length > 0) {
                msg += ' ' + JSON.stringify(rest, null, 2);
              }
            }
            
            return msg;
          })
        ),
        transports: [
          new winston.transports.Console({
            forceConsole: true, // Routes console transport messages to console methods instead of stdout/stderr
            format: winston.format.combine(
              winston.format.colorize({ all: true }),
              winston.format.printf(({ timestamp, level, message, ...metadata }) => {
                let msg = `${timestamp} [${level}]: ${message}`;
                
                // Add metadata if present
                if (Object.keys(metadata).length > 0) {
                  // Remove known winston properties
                  const { level: _level, message: _message, timestamp: _timestamp, ...rest } = metadata as any;
                  if (Object.keys(rest).length > 0) {
                    msg += ' ' + JSON.stringify(rest, null, 2);
                  }
                }
                
                return msg;
              })
            )
          })
        ]
      });
    }

    return Logger.instance;
  }
}

// Export the singleton instance
export const logger = Logger.getInstance();
