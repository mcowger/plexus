import pino from "pino";
import type { LoggingConfig } from "../types/config";

type LogLevel = "silly" | "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  component?: string;
  [key: string]: unknown;
}

export class Logger {
  private pinoLogger: pino.Logger;

  constructor(pinoInstance?: pino.Logger) {
    if (pinoInstance) {
      this.pinoLogger = pinoInstance;
    } else {
      this.pinoLogger = pino({
        level: "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      });
    }
  }

  configure(config: LoggingConfig): void {
    const level = config.level === "silly" ? "trace" : config.level;
    this.pinoLogger.level = level;
  }

  setContext(context: LogContext): void {
    this.pinoLogger = this.pinoLogger.child(context);
  }

  child(context: LogContext): Logger {
    return new Logger(this.pinoLogger.child(context));
  }

  silly(message: string, meta?: object): void {
    this.pinoLogger.trace(meta || {}, message);
  }

  debug(message: string, meta?: object): void {
    this.pinoLogger.debug(meta || {}, message);
  }

  info(message: string, meta?: object): void {
    this.pinoLogger.info(meta || {}, message);
  }

  warn(message: string, meta?: object): void {
    this.pinoLogger.warn(meta || {}, message);
  }

  error(message: string, meta?: object): void {
    this.pinoLogger.error(meta || {}, message);
  }
}

// Export singleton instance
export const logger = new Logger();