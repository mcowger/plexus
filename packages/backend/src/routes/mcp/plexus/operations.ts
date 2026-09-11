import {
  McpToolError,
  type ManagementShimContext,
  type ToolInput,
  type ToolResponse,
} from './types';
import { callManagementRoute, encodePathPreservingSlashes } from './management';
import {
  asOptionalString,
  mapRecordResponse,
  requireId,
  stripNamedId,
  successResponse,
  unsupportedOperation,
} from './responses';
import { redactSecrets } from './security';

export async function handleUsageTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/usage',
          undefined,
          input.query
        )
      );
    case 'summary':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/usage/summary',
          undefined,
          input.query
        )
      );
    case 'delete':
      if (!input.id) {
        throw new McpToolError('Missing id for usage delete operation.', 'invalid_request', 400);
      }
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/usage/${encodePathPreservingSlashes(input.id)}`
        )
      );
    case 'delete_all':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          '/v0/management/usage',
          undefined,
          input.query
        )
      );
    default:
      throw unsupportedOperation(input.operation, ['list', 'summary', 'delete', 'delete_all']);
  }
}

export async function handleDebugTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'state':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/debug')
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'PATCH', '/v0/management/debug', input.body ?? {})
      );
    case 'logs':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/debug/logs',
          undefined,
          input.query
        )
      );
    case 'get_log':
      if (!input.id) {
        throw new McpToolError('Missing id for debug get_log operation.', 'invalid_request', 400);
      }
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          `/v0/management/debug/logs/${encodePathPreservingSlashes(input.id)}`
        )
      );
    case 'delete_log':
      if (!input.id) {
        throw new McpToolError(
          'Missing id for debug delete_log operation.',
          'invalid_request',
          400
        );
      }
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/debug/logs/${encodePathPreservingSlashes(input.id)}`
        )
      );
    case 'delete_all_logs':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/debug/logs')
      );
    default:
      throw unsupportedOperation(input.operation, [
        'state',
        'update',
        'logs',
        'get_log',
        'delete_log',
        'delete_all_logs',
      ]);
  }
}

export async function handleOperationsTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'backup': {
      const full = input.query?.full === true || asOptionalString(input.query?.full) === 'true';
      if (full) {
        const archive = await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/backup',
          undefined,
          { full: 'true' },
          true
        );
        return successResponse(input.operation, {
          full: true,
          bytes: archive.byteLength,
          contentType: 'application/gzip',
          encoding: 'base64',
          archive: archive.toString('base64'),
        });
      }
      return successResponse(input.operation, {
        full: false,
        backup: await callManagementRoute(shimContext, 'GET', '/v0/management/backup'),
      });
    }
    case 'restore': {
      const body = input.body ?? {};
      if (body.full === true || typeof body.archive === 'string') {
        if (typeof body.archive !== 'string') {
          throw new McpToolError(
            'body.archive must be a base64 string for full restore.',
            'invalid_request',
            400
          );
        }
        return successResponse(
          input.operation,
          await callManagementRoute(
            shimContext,
            'POST',
            '/v0/management/restore',
            Buffer.from(body.archive, 'base64'),
            undefined,
            false,
            { 'content-type': 'application/gzip' }
          )
        );
      }
      if (!body.plexus_backup) {
        throw new McpToolError(
          'Invalid backup: missing plexus_backup field',
          'invalid_request',
          400
        );
      }
      return successResponse(input.operation, {
        ...(await callManagementRoute(shimContext, 'POST', '/v0/management/restore', body)),
      });
    }
    case 'restart':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'POST', '/v0/management/restart')
      );
    case 'refresh_metadata':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'POST', '/v0/management/models/metadata/refresh')
      );
    case 'list_cooldowns':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/cooldowns')
      );
    case 'clear_cooldowns': {
      const provider = input.id ?? asOptionalString(input.query?.provider);
      const model = asOptionalString(input.query?.model);
      return successResponse(
        input.operation,
        provider
          ? await callManagementRoute(
              shimContext,
              'DELETE',
              `/v0/management/cooldowns/${encodePathPreservingSlashes(provider)}`,
              undefined,
              model ? { model } : undefined
            )
          : await callManagementRoute(shimContext, 'DELETE', '/v0/management/cooldowns')
      );
    }
    case 'reset_logs':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/logs/reset')
      );
    default:
      throw unsupportedOperation(input.operation, [
        'backup',
        'restore',
        'restart',
        'refresh_metadata',
        'list_cooldowns',
        'clear_cooldowns',
        'reset_logs',
      ]);
  }
}

export async function handleMcpGatewayTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'servers_list':
    case 'list': {
      const servers = await callManagementRoute(shimContext, 'GET', '/v0/management/mcp-servers');
      return successResponse(input.operation, mapRecordResponse(redactSecrets(servers)));
    }
    case 'get': {
      const id = requireId(input, 'mcp_gateway');
      const server = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/mcp-servers/${encodeURIComponent(id)}`
      );
      return successResponse(input.operation, {
        id,
        ...stripNamedId(redactSecrets(server), 'name'),
      });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/mcp-servers/${encodeURIComponent(requireId(input, 'mcp_gateway'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/mcp-servers/${encodeURIComponent(requireId(input, 'mcp_gateway'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/mcp-servers/${encodeURIComponent(requireId(input, 'mcp_gateway'))}`
        )
      );
    case 'status':
    case 'logs': {
      const id = requireId(input, 'mcp_gateway');
      const suffix = input.operation === 'logs' ? 'process-logs' : 'status';
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          `/v0/management/mcp-servers/${encodeURIComponent(id)}/${suffix}`
        )
      );
    }
    case 'start':
    case 'stop':
    case 'restart': {
      const id = requireId(input, 'mcp_gateway');
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          `/v0/management/mcp-servers/${encodeURIComponent(id)}/${input.operation}`
        )
      );
    }
    default:
      throw unsupportedOperation(input.operation, [
        'servers_list',
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'status',
        'start',
        'stop',
        'restart',
        'logs',
      ]);
  }
}

export async function handleSystemLogsTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'recent':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/system/logs/recent',
          undefined,
          input.query
        )
      );
    case 'level':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/logging/level')
      );
    case 'set_level': {
      const level = asOptionalString(input.body?.level) ?? asOptionalString(input.query?.level);
      if (!level) {
        throw new McpToolError(
          'Missing level for set_level operation. Provide body.level or query.level.',
          'invalid_request',
          400
        );
      }
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'PUT', '/v0/management/logging/level', { level })
      );
    }
    case 'reset_level':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/logging/level')
      );
    default:
      throw unsupportedOperation(input.operation, ['recent', 'level', 'set_level', 'reset_level']);
  }
}
