import { getConfig } from '../../../config';
import { logger } from '../../../utils/logger';
import {
  handleConfigTool,
  handleKeyTool,
  handleModelAliasTool,
  handleProviderTool,
  handleQuotaCheckerTool,
  handleQuotaTool,
  handleSettingsTool,
} from './configuration';
import {
  handleDebugTool,
  handleMcpGatewayTool,
  handleOperationsTool,
  handleSystemLogsTool,
  handleUsageTool,
} from './operations';
import { DESTRUCTIVE_OPERATIONS, requireDestructiveAck } from './security';
import { errorResponse } from './responses';
import {
  McpToolError,
  type ManagementShimContext,
  type PlexusToolName,
  type ToolInput,
} from './types';

export async function handleToolCall(
  toolName: PlexusToolName,
  input: ToolInput,
  shimContext: ManagementShimContext
) {
  try {
    if (DESTRUCTIVE_OPERATIONS.has(input.operation)) {
      requireDestructiveAck(input);
    }

    getConfig();

    switch (toolName) {
      case 'plexus_config':
        return await handleConfigTool(input, shimContext);
      case 'plexus_provider':
        return await handleProviderTool(input, shimContext);
      case 'plexus_model_alias':
        return await handleModelAliasTool(input, shimContext);
      case 'plexus_key':
        return await handleKeyTool(input, shimContext);
      case 'plexus_quota':
        return await handleQuotaTool(input, shimContext);
      case 'plexus_quota_checker':
        return await handleQuotaCheckerTool(input, shimContext);
      case 'plexus_mcp_gateway':
        return await handleMcpGatewayTool(input, shimContext);
      case 'plexus_settings':
        return await handleSettingsTool(input, shimContext);
      case 'plexus_system_logs':
        return await handleSystemLogsTool(input, shimContext);
      case 'plexus_usage':
        return await handleUsageTool(input, shimContext);
      case 'plexus_debug':
        return await handleDebugTool(input, shimContext);
      case 'plexus_operations':
        return await handleOperationsTool(input, shimContext);
    }
  } catch (error) {
    if (error instanceof McpToolError) {
      return errorResponse(input.operation, error.message, error.type, error.code);
    }
    logger.warn(`Plexus MCP tool ${toolName} failed: ${(error as Error).message}`);
    return errorResponse(input.operation, 'Plexus MCP tool call failed.', 'internal_error', 500);
  }
}
