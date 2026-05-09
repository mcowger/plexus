import winston from 'winston';
import Transport from 'winston-transport';
import { EventEmitter } from 'events';
import path from 'path';

const { combine, timestamp, printf, colorize, splat, json } = winston.format;

export const SUPPORTED_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'] as const;
export type LogLevel = (typeof SUPPORTED_LOG_LEVELS)[number];

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

// ─── Automatic Caller Detection (with caching) ─────────────────────
//
// Injects [module] and [functionName] into every log entry by parsing
// the call stack. Results are cached per source location for massive
// performance improvement on repeated calls.
//
const callerCache = new Map<string, { module: string; functionName: string }>();

const addCallerInfo = winston.format((info) => {
  const stack = new Error().stack;
  if (!stack) return info;

  const lines = stack.split('\n');
  let cacheKey: string | null = null;

  // Walk up the stack, skipping frames that originate from:
  //   - winston / logform internals (node_modules)
  //   - this logger file itself
  //   - Bun's runtime noise
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip library / runtime frames
    if (
      line.includes('/node_modules/') ||
      line.includes('/utils/logger.ts') ||
      line.includes('node:internal') ||
      line.includes('Bun')
    ) {
      continue;
    }

    // Extract the key for caching (file:line)
    const lineMatch = line.match(/(?:\/[^:]+)\.(ts|js)(?::\d+)/);
    if (lineMatch) {
      const matchIndex = lineMatch.index!;
      const from = line.lastIndexOf(' ', matchIndex) + 1;
      cacheKey = line.slice(from).replace(/^file:\/\//, '');

      // Check cache first
      const cached = callerCache.get(cacheKey);
      if (cached) {
        info.module = cached.module;
        info.functionName = cached.functionName;
        return info;
      }
    }

    // Bun stack format: "at /path/file.ts:10:5"
    // Node/V8 format:   "at fn (/path/file.ts:10:5)"
    //                  "at Object.<anonymous> (/path/file.ts:10:5)"
    const fileMatch = line.match(/(?:\/[^:]+)\.(ts|js)(?::\d+:\d+)/);
    if (fileMatch) {
      // Walk backwards from the match position to capture the full path
      const matchIndex = fileMatch.index!;
      const from = line.lastIndexOf(' ', matchIndex) + 1;
      const bare = line.slice(from).replace(/^file:\/\//, '');
      const fullPath = bare.split(':')[0] || ''; // strip line/col
      const filename = path.basename(fullPath);
      if (filename === 'index.ts' || filename === 'index.js') {
        // Use the parent directory name for index files
        info.module = path.basename(path.dirname(fullPath));
      } else {
        info.module = filename.replace(/\.(ts|js)$/, '');
      }

      // Extract function name (present in Node/V8 format, absent in Bun)
      const fnMatch = line.match(/at\s+(.+?)\s+\(/);
      if (fnMatch && fnMatch[1]) {
        const fn = fnMatch[1].replace(/^Object\./, '');
        if (fn !== '<anonymous>') {
          info.functionName = fn;
        }
      }

      // Cache the result for this location
      if (cacheKey) {
        callerCache.set(cacheKey, {
          module: info.module as string,
          functionName: info.functionName as string,
        });
      }
      break;
    }
  }
  return info;
});

// ─── Module Filter ──────────────────────────────────────────────────
//
// Set LOG_MODULES env var to a comma-separated list of module names to
// restrict console output to only those modules.  Empty = show all.
// Can also be changed at runtime via the management API.
//
const moduleFilter = new Set<string>();

const envModuleFilter = process.env.LOG_MODULES;
if (envModuleFilter) {
  for (const m of envModuleFilter.split(',')) {
    const trimmed = m.trim();
    if (trimmed) moduleFilter.add(trimmed);
  }
}

export const getModuleFilter = (): string[] => [...moduleFilter];
export const clearModuleFilter = (): void => {
  moduleFilter.clear();
};
export const setModuleFilter = (modules: string[]): void => {
  moduleFilter.clear();
  for (const m of modules) {
    if (m) moduleFilter.add(m);
  }
};
export const addModuleFilter = (mod: string): void => {
  if (mod) moduleFilter.add(mod);
};

const filterModule = winston.format((info) => {
  if (moduleFilter.size > 0 && info.module && !moduleFilter.has(info.module as string)) {
    return false;
  }
  return info;
});

// ─── Level Width Alignment ──────────────────────────────────────────
// Pad the level name to match the widest level so the [module] column
// stays aligned regardless of level name length.
const MAX_LEVEL_LEN = Math.max(...SUPPORTED_LOG_LEVELS.map((l) => l.length)); // 7 (verbose)

const padLevel = winston.format((info) => {
  info.level = info.level.padEnd(MAX_LEVEL_LEN);
  return info;
});

// ─── Console Format ─────────────────────────────────────────────────

const consoleFormat = printf(
  ({ level, message, timestamp, module: mod, functionName, ...metadata }) => {
    const modPart = mod ? ` [${mod}]` : '';
    let msg = `${timestamp} [${level}]${modPart}: ${message}`;

    // Strip `module` and `functionName` from the metadata dump since
    // they are already rendered as part of the formatted line.
    const {
      module: _m,
      functionName: _f,
      splat: _s,
      ...rest
    } = metadata as Record<string, unknown>;

    if (Object.keys(rest).length > 0) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value instanceof Error) {
          sanitized[key] = {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        } else {
          sanitized[key] = value;
        }
      }
      msg += ` ${JSON.stringify(sanitized, null, 2)}`;
    }
    return msg;
  }
);

// Determine log level: If DEBUG=true is set, use 'debug' level unless LOG_LEVEL is explicitly set
const normalizeLogLevel = (level: unknown): LogLevel | null => {
  if (typeof level !== 'string') {
    return null;
  }

  const normalized = level.trim().toLowerCase();
  if (SUPPORTED_LOG_LEVELS.includes(normalized as LogLevel)) {
    return normalized as LogLevel;
  }

  return null;
};

export const getStartupLogLevel = (): LogLevel => {
  const envLogLevel = normalizeLogLevel(process.env.LOG_LEVEL);
  if (envLogLevel) {
    return envLogLevel;
  }

  if (process.env.DEBUG === 'true') {
    return 'debug';
  }

  return 'info';
};

let currentLogLevel: LogLevel = getStartupLogLevel();

export const getCurrentLogLevel = (): LogLevel => currentLogLevel;

export const setCurrentLogLevel = (level: string): LogLevel => {
  const normalized = normalizeLogLevel(level);
  if (!normalized) {
    throw new Error(
      `Invalid log level '${level}'. Supported levels: ${SUPPORTED_LOG_LEVELS.join(', ')}`
    );
  }

  currentLogLevel = normalized;
  logger.level = normalized;
  return normalized;
};

export const resetCurrentLogLevel = (): LogLevel => {
  const startupLevel = getStartupLogLevel();
  currentLogLevel = startupLevel;
  logger.level = startupLevel;
  return startupLevel;
};

export const logger = winston.createLogger({
  level: currentLogLevel,
  // Default format — used by transports without their own format (StreamTransport).
  // addCallerInfo runs before json() so the JSON payload includes {module, functionName}.
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), splat(), addCallerInfo(), json()),
  transports: [
    new winston.transports.Console({
      format: combine(
        padLevel(),
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        splat(),
        addCallerInfo(),
        filterModule(),
        consoleFormat
      ),
    }),
    new StreamTransport(),
  ],
});
