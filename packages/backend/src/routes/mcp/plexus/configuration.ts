import { callManagementRoute, encodePathPreservingSlashes, PATCH_MERGE_QUERY } from './management';
import {
  asObject,
  mapRecordResponse,
  requireId,
  stripNamedId,
  successResponse,
  unsupportedOperation,
} from './responses';
import { redactSecrets } from './security';
import {
  type ManagementShimContext,
  McpToolError,
  type ToolInput,
  type ToolResponse,
} from './types';

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
          input.body ?? {},
          PATCH_MERGE_QUERY
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

export async function handlePiCatalogTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'providers':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/pi/providers')
      );
    case 'models': {
      const provider = requireId(input, 'pi-ai provider');
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/pi/models', undefined, {
          provider,
          q: typeof input.query?.q === 'string' ? input.query.q : undefined,
        })
      );
    }
    case 'validate_config': {
      const [configuredProviders, catalogProvidersResponse] = await Promise.all([
        callManagementRoute(shimContext, 'GET', '/v0/management/providers'),
        callManagementRoute(shimContext, 'GET', '/v0/management/pi/providers'),
      ]);
      const catalogProviderIds = new Set(
        Array.isArray(catalogProvidersResponse?.data)
          ? catalogProvidersResponse.data.filter(
              (provider: unknown): provider is string => typeof provider === 'string'
            )
          : []
      );
      const configured = Object.entries(asObject(configuredProviders)).flatMap(
        ([providerId, value]) => {
          const provider = asObject(value);
          const piAiProvider =
            typeof provider.pi_ai_provider === 'string' && provider.pi_ai_provider
              ? provider.pi_ai_provider
              : null;
          const models =
            provider.models &&
            typeof provider.models === 'object' &&
            !Array.isArray(provider.models)
              ? Object.entries(provider.models)
              : [];
          const modelReferences = models.flatMap(([modelId, modelValue]) => {
            const piAiModelId = asObject(modelValue).pi_ai_model_id;
            return typeof piAiModelId === 'string' && piAiModelId ? [{ modelId, piAiModelId }] : [];
          });
          if (!piAiProvider && modelReferences.length === 0) return [];
          return [{ providerId, piAiProvider, models: modelReferences }];
        }
      );
      const modelsByProvider = new Map<string, Set<string>>();
      await Promise.all(
        [...new Set(configured.flatMap(({ piAiProvider }) => (piAiProvider ? [piAiProvider] : [])))]
          .filter((provider) => catalogProviderIds.has(provider))
          .map(async (provider) => {
            const response = await callManagementRoute(
              shimContext,
              'GET',
              '/v0/management/pi/models',
              undefined,
              { provider }
            );
            modelsByProvider.set(
              provider,
              new Set(
                Array.isArray(response?.data)
                  ? response.data.flatMap((model: unknown) =>
                      typeof asObject(model).id === 'string' ? [asObject(model).id as string] : []
                    )
                  : []
              )
            );
          })
      );

      const results = configured.map(({ providerId, piAiProvider, models }) => {
        const validProvider = piAiProvider !== null && catalogProviderIds.has(piAiProvider);
        const modelResults = models.map(({ modelId, piAiModelId }) => ({
          id: modelId,
          pi_ai_model_id: piAiModelId,
          valid:
            validProvider &&
            piAiProvider !== null &&
            (modelsByProvider.get(piAiProvider)?.has(piAiModelId) ?? false),
        }));
        return {
          provider: providerId,
          pi_ai_provider: piAiProvider,
          validProvider,
          models: modelResults,
          valid: validProvider && modelResults.every(({ valid }) => valid),
        };
      });
      const checkedModels = results.reduce((total, result) => total + result.models.length, 0);
      return successResponse(input.operation, {
        valid: results.every(({ valid }) => valid),
        checkedProviders: results.length,
        checkedModels,
        invalidProviders: results.filter(({ validProvider }) => !validProvider).length,
        invalidModels: results.reduce(
          (total, result) => total + result.models.filter(({ valid }) => !valid).length,
          0
        ),
        results,
      });
    }
    default:
      throw unsupportedOperation(input.operation, ['providers', 'models', 'validate_config']);
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
          input.body ?? {},
          PATCH_MERGE_QUERY
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
          input.body ?? {},
          PATCH_MERGE_QUERY
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
          input.body ?? {},
          PATCH_MERGE_QUERY
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
