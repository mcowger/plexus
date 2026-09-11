import {
  McpToolError,
  type ManagementShimContext,
  type ToolInput,
  type ToolResponse,
} from './types';
import { callManagementRoute, encodePathPreservingSlashes } from './management';
import {
  asObject,
  mapRecordResponse,
  requireId,
  stripNamedId,
  successResponse,
  unsupportedOperation,
} from './responses';
import { redactSecrets } from './security';

export async function handleConfigTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'get':
      return successResponse(
        input.operation,
        redactSecrets(await callManagementRoute(shimContext, 'GET', '/v0/management/config'))
      );
    case 'export':
      return successResponse(
        input.operation,
        redactSecrets(await callManagementRoute(shimContext, 'GET', '/v0/management/config/export'))
      );
    case 'status':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/config/status')
      );
    default:
      throw unsupportedOperation(input.operation, ['get', 'export', 'status']);
  }
}

export async function handleProviderTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const providers = await callManagementRoute(shimContext, 'GET', '/v0/management/providers');
      return successResponse(input.operation, mapRecordResponse(redactSecrets(providers)));
    }
    case 'get': {
      const id = requireId(input, 'provider');
      const provider = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/providers/${encodePathPreservingSlashes(id)}`
      );
      return successResponse(input.operation, { id, ...asObject(redactSecrets(provider)) });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/providers/${encodePathPreservingSlashes(requireId(input, 'provider'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/providers/${encodePathPreservingSlashes(requireId(input, 'provider'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/providers/${encodePathPreservingSlashes(requireId(input, 'provider'))}`,
          undefined,
          input.query
        )
      );
    case 'fetch_models':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          '/v0/management/providers/fetch-models',
          input.body ?? {}
        )
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'fetch_models',
      ]);
  }
}

export async function handleModelAliasTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const aliases = await callManagementRoute(shimContext, 'GET', '/v0/management/aliases');
      return successResponse(input.operation, mapRecordResponse(aliases));
    }
    case 'get': {
      const id = requireId(input, 'model_alias');
      const alias = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/aliases/${encodePathPreservingSlashes(id)}`
      );
      return successResponse(input.operation, { id, ...stripNamedId(alias, 'slug') });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/aliases/${encodePathPreservingSlashes(requireId(input, 'model_alias'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/aliases/${encodePathPreservingSlashes(requireId(input, 'model_alias'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/models/${encodePathPreservingSlashes(requireId(input, 'model_alias'))}`
        )
      );
    case 'delete_all':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/models')
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'delete_all',
      ]);
  }
}

export async function handleKeyTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const keys = await callManagementRoute(shimContext, 'GET', '/v0/management/keys');
      return successResponse(input.operation, mapRecordResponse(redactSecrets(keys)));
    }
    case 'get': {
      const id = requireId(input, 'key');
      const key = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/keys/${encodeURIComponent(id)}`
      );
      return successResponse(input.operation, { id, ...stripNamedId(redactSecrets(key), 'name') });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}`
        )
      );
    case 'disable':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}/disable`
        )
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'disable',
      ]);
  }
}

export async function handleQuotaTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const quotas = await callManagementRoute(shimContext, 'GET', '/v0/management/user-quotas');
      return successResponse(input.operation, mapRecordResponse(quotas));
    }
    case 'get': {
      const id = requireId(input, 'quota');
      const quota = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/user-quotas/${encodeURIComponent(id)}`
      );
      return successResponse(input.operation, { id, ...stripNamedId(quota, 'name') });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/user-quotas/${encodeURIComponent(requireId(input, 'quota'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/user-quotas/${encodeURIComponent(requireId(input, 'quota'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/user-quotas/${encodeURIComponent(requireId(input, 'quota'))}`
        )
      );
    case 'status': {
      const key = requireId(input, 'key');
      const status = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/quota/status/${encodeURIComponent(key)}`
      );
      return successResponse(input.operation, status);
    }
    case 'clear':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          '/v0/management/quota/clear',
          input.body ?? {}
        )
      );
    case 'recompute':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          '/v0/management/quota/recompute',
          input.body ?? {}
        )
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'status',
        'clear',
        'recompute',
      ]);
  }
}

export async function handleQuotaCheckerTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/quota-checkers')
      );
    case 'get':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          `/v0/management/quotas/${encodeURIComponent(requireId(input, 'quota checker'))}`
        )
      );
    case 'types':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/quota-checker-types')
      );
    default:
      throw unsupportedOperation(input.operation, ['types', 'list', 'get']);
  }
}

export async function handleSettingsTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  if (input.operation !== 'get') {
    throw unsupportedOperation(input.operation, ['get']);
  }

  const categories = {
    failover: '/v0/management/config/failover',
    cooldown: '/v0/management/config/cooldown',
    timeout: '/v0/management/config/timeout',
    stall: '/v0/management/config/stall',
    trusted_proxies: '/v0/management/config/trusted-proxies',
    vision_fallthrough: '/v0/management/config/vision-fallthrough',
    background_exploration: '/v0/management/config/background-exploration',
    exploration: '/v0/management/config/exploration-rate',
  } as const;

  if (!input.category || input.category === 'all') {
    const [
      failover,
      cooldown,
      timeout,
      stall,
      trusted_proxies,
      vision_fallthrough,
      background_exploration,
      exploration,
    ] = await Promise.all([
      callManagementRoute(shimContext, 'GET', categories.failover),
      callManagementRoute(shimContext, 'GET', categories.cooldown),
      callManagementRoute(shimContext, 'GET', categories.timeout),
      callManagementRoute(shimContext, 'GET', categories.stall),
      callManagementRoute(shimContext, 'GET', categories.trusted_proxies),
      callManagementRoute(shimContext, 'GET', categories.vision_fallthrough),
      callManagementRoute(shimContext, 'GET', categories.background_exploration),
      callManagementRoute(shimContext, 'GET', categories.exploration),
    ]);
    return successResponse(input.operation, {
      failover,
      cooldown,
      timeout,
      stall,
      trusted_proxies,
      vision_fallthrough,
      background_exploration,
      exploration,
    });
  }

  if (!(input.category in categories)) {
    throw new McpToolError(
      `settings category '${input.category}' was not found.`,
      'not_found',
      404
    );
  }

  return successResponse(
    input.operation,
    await callManagementRoute(
      shimContext,
      'GET',
      categories[input.category as keyof typeof categories]
    )
  );
}
