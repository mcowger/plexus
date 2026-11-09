import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { MCP_RESULT_LIMIT_BYTES, McpResultStore, serializeToolResponse } from './result-store';
import { McpToolError, type ToolInput, type ToolResponse } from './types';

export function requireId(input: ToolInput, resourceType: string): string {
  if (!input.id) {
    throw new McpToolError(`Missing id for ${resourceType} operation.`, 'invalid_request', 400);
  }
  return input.id;
}

export function mapRecordResponse(records: unknown): Array<Record<string, unknown>> {
  const object = asObject(records);
  return Object.entries(object).map(([id, value]) => ({ id, ...asObject(value) }));
}

export function stripNamedId(value: unknown, key: string): Record<string, unknown> {
  const object = asObject(value);
  const { [key]: _ignored, ...rest } = object;
  return rest;
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function toMcpToolError(response: { statusCode: number; body: string }): McpToolError {
  let parsed: any = null;
  try {
    parsed = response.body ? JSON.parse(response.body) : null;
  } catch {
    parsed = null;
  }

  const message =
    parsed?.error?.message ??
    parsed?.error ??
    parsed?.message ??
    (response.body || 'Management request failed');
  const type =
    parsed?.error?.type ??
    (response.statusCode === 404
      ? 'not_found'
      : response.statusCode === 409
        ? 'conflict_error'
        : response.statusCode === 400
          ? 'invalid_request'
          : 'server_error');
  const code = parsed?.error?.code ?? response.statusCode;
  return new McpToolError(message, type, code);
}

export function toToolResult(
  response: ToolResponse,
  store: McpResultStore,
  baseUrl: string
): CallToolResult {
  const body = serializeToolResponse(response);
  const result: CallToolResult = {
    content: [{ type: 'text', text: body }],
    isError: !response.ok,
  };
  const bytes = Buffer.byteLength(body, 'utf8');
  if (
    bytes <= MCP_RESULT_LIMIT_BYTES &&
    Buffer.byteLength(JSON.stringify(result), 'utf8') <= MCP_RESULT_LIMIT_BYTES
  )
    return result;
  // The operation is caller-controlled and may itself be too large for the cap.
  const operation =
    Buffer.byteLength(response.operation, 'utf8') <= 256 ? response.operation : '[omitted]';

  const stored = store.put(body, bytes);
  if (!stored) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            operation,
            error: {
              message: 'Result exceeds the temporary download storage limit.',
              type: 'result_too_large',
              code: 413,
            },
            bytes,
          }),
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: response.ok,
          operation,
          reason: 'The tool result exceeds the 128 KiB response limit.',
          instructions:
            'Make an HTTP GET request to download.url and save the JSON to a file, for example with curl or fetch. The URL grants access only to this result and expires after 15 minutes; no admin key is needed. For debug traces and inference errors, read the MCP resource plexus://management/log-formats.',
          download: {
            url: `${baseUrl}/mcp/plexus/results/${stored.id}?token=${stored.token}`,
            bytes,
            expiresAt: new Date(stored.expiresAt).toISOString(),
            contentType: 'application/json',
          },
        }),
      },
    ],
    isError: !response.ok,
  };
}

export function successResponse(operation: string, data: unknown): ToolResponse {
  return { ok: true, operation, data };
}

export function errorResponse(
  operation: string,
  message: string,
  type: string,
  code: number
): ToolResponse {
  return {
    ok: false,
    operation,
    error: { message, type, code },
  };
}

export function unsupportedOperation(operation: string, allowed: string[]) {
  return new McpToolError(
    `Unsupported operation '${operation}'. Allowed operations: ${allowed.join(', ')}.`,
    'invalid_request',
    400
  );
}
