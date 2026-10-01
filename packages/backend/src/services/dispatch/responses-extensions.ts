import {
  getDefaultResponsesExtensions,
  RESPONSES_LITE_EXTENSIONS,
  type ResponsesExtension,
} from '@plexus/shared';
import { getApiBaseType, getApiSubtype } from '../../utils/api-format';
import type { RouteResult } from '../routing/router';

/**
 * Responses API extensions (namespace tools, custom tools, Codex lite items)
 * are forwarded verbatim only when the target accepts every extension the
 * body carries. Anything else takes the transform pipeline, which flattens
 * them to plain function tools and splits them back on the response
 * (transformers/responses/tool-mapper.ts). One rule for every host; each
 * target only declares what it accepts.
 */

/** Tool `type` declared by each tool-declaration extension. */
const EXTENSION_TOOL_TYPES: Partial<Record<ResponsesExtension, string>> = {
  namespace_tools: 'namespace',
  custom_tools: 'custom',
  tool_search: 'tool_search',
};

/** Tool `type`s the responses:lite wire contract accepts in `tools`. */
export const LITE_ALLOWED_TOOL_TYPES: ReadonlySet<string> = new Set([
  'function',
  ...RESPONSES_LITE_EXTENSIONS.flatMap((extension) => EXTENSION_TOOL_TYPES[extension] ?? []),
]);

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object';
}

/** Names of every `namespace` tool declared on `tools` or in `additional_tools` items. */
function declaredNamespaces(body: Record<string, any>): Set<string> {
  const declarations = [
    ...(Array.isArray(body.tools) ? body.tools : []),
    ...(Array.isArray(body.input)
      ? body.input.flatMap((item: any) =>
          isObject(item) && item.type === 'additional_tools' && Array.isArray(item.tools)
            ? item.tools
            : []
        )
      : []),
  ];
  return new Set(
    declarations
      .filter((tool: any) => isObject(tool) && tool.type === 'namespace')
      .map((tool: any) => tool.name)
      .filter((name: unknown): name is string => typeof name === 'string')
  );
}

/** Muse Code's `name: "<namespace>.<tool>"` spelling, against a declared namespace. */
function isDottedCall(item: Record<string, any>, namespaces: Set<string>): boolean {
  if (typeof item.name !== 'string') return false;
  const dot = item.name.indexOf('.');
  return dot > 0 && namespaces.has(item.name.slice(0, dot));
}

/** A `custom` tool declaration, directly or nested in a namespace (Codex lite nests `exec`). */
function declaresCustomTool(tool: unknown): boolean {
  if (!isObject(tool)) return false;
  if (tool.type === 'custom') return true;
  return (
    tool.type === 'namespace' &&
    Array.isArray(tool.tools) &&
    tool.tools.some((sub: unknown) => isObject(sub) && sub.type === 'custom')
  );
}

/** Every Responses extension present on a request body. */
export function detectResponsesExtensions(body: unknown): Set<ResponsesExtension> {
  const found = new Set<ResponsesExtension>();
  if (!isObject(body)) return found;

  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!isObject(tool)) continue;
      if (tool.type === 'namespace') found.add('namespace_tools');
      else if (tool.type === 'tool_search') found.add('tool_search');
      if (declaresCustomTool(tool)) found.add('custom_tools');
    }
  }

  if (Array.isArray(body.input)) {
    const namespaces = declaredNamespaces(body);
    for (const item of body.input) {
      if (!isObject(item) || typeof item.type !== 'string') continue;
      if (item.type === 'function_call') {
        if (typeof item.namespace === 'string') found.add('namespaced_calls');
        else if (isDottedCall(item, namespaces)) found.add('dotted_calls');
      } else if (item.type === 'custom_tool_call' || item.type === 'custom_tool_call_output') {
        found.add('custom_calls');
      } else if (item.type === 'additional_tools') {
        found.add('additional_tools');
        if (Array.isArray(item.tools) && item.tools.some(declaresCustomTool)) {
          found.add('custom_tools');
        }
      } else if (item.type.startsWith('tool_search')) {
        found.add('tool_search');
      }
    }
  }

  return found;
}

/**
 * Extensions the route's target accepts verbatim:
 *   - `responses:lite` targets: the fixed lite wire contract, which the
 *     upstream enforces whatever the provider setting says;
 *   - plain `responses` targets: the provider's explicit
 *     `responses_extensions` (`[]` accepts none), else the default from its
 *     OAuth provider or Responses endpoint host (see
 *     getDefaultResponsesExtensions).
 */
export function resolveSupportedResponsesExtensions(
  route: RouteResult,
  targetApiType: string
): ReadonlySet<ResponsesExtension> {
  if (getApiSubtype(targetApiType) === 'lite') return new Set(RESPONSES_LITE_EXTENSIONS);
  const explicit = route.config.responses_extensions;
  if (explicit) return new Set(explicit);
  return new Set(
    getDefaultResponsesExtensions({
      oauthProvider: route.config.oauth_provider,
      apiBaseUrl: route.config.api_base_url,
    })
  );
}

/**
 * True when a Responses-bound body carries an extension the target doesn't
 * accept verbatim, so it must be flattened by the transform pipeline.
 */
export function hasUnsupportedResponsesExtensions(
  body: unknown,
  route: RouteResult,
  targetApiType: string
): boolean {
  if (getApiBaseType(targetApiType) !== 'responses') return false;
  const detected = detectResponsesExtensions(body);
  if (detected.size === 0) return false;
  const supported = resolveSupportedResponsesExtensions(route, targetApiType);
  return [...detected].some((extension) => !supported.has(extension));
}
