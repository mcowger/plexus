const METER_MARKER = '__plexus_quota_meter__';

function requestHeaders(options: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
  }
  if (
    options.useApiKey !== false &&
    typeof options.apiKey === 'string' &&
    options.apiKey.length > 0
  ) {
    const header =
      typeof options.authHeader === 'string' && options.authHeader.trim().length > 0
        ? options.authHeader
        : 'Authorization';
    const prefix = typeof options.authPrefix === 'string' ? options.authPrefix.trim() : 'Bearer';
    headers[header] = prefix ? `${prefix} ${options.apiKey}` : options.apiKey;
  }
  return headers;
}

function createContext(request: {
  checkerId: string;
  provider: string;
  options: Record<string, unknown>;
}) {
  return {
    checkerId: request.checkerId,
    provider: request.provider,
    options: request.options,
    getOption<T>(key: string, defaultValue: T): T {
      return (request.options[key] as T) ?? defaultValue;
    },
    requireOption<T>(key: string): T {
      const value = request.options[key] as T | undefined;
      if (value === undefined) {
        throw new Error(
          `Required option '${key}' not provided for quota checker '${request.checkerId}'`
        );
      }
      return value;
    },
    requestHeaders() {
      return requestHeaders(request.options);
    },
    fetch(input: string | URL, init: RequestInit = {}) {
      const headers = new Headers(requestHeaders(request.options));
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      return globalThis.fetch(input, { ...init, headers });
    },
    balance(params: unknown) {
      return { [METER_MARKER]: 'balance', params };
    },
    allowance(params: unknown) {
      return { [METER_MARKER]: 'allowance', params };
    },
  };
}

self.onmessage = async (event: MessageEvent) => {
  const request = event.data as {
    code: string;
    checkerId: string;
    provider: string;
    options: Record<string, unknown>;
  };

  try {
    const check = new Function(
      'ctx',
      `"use strict"; return (async () => {\n${request.code}\n})();`
    );
    const meters = await check(createContext(request));
    self.postMessage({ ok: true, meters });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof SyntaxError ? 'syntax' : 'runtime',
    });
  }
};
