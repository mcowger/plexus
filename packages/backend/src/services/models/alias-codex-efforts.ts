import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';

import { getProviderTypes, type ModelConfig, type ProviderConfig } from '../../config';
import {
  isDecisionsTargetApiType,
  isImageTargetApiType,
  normalizeApiAccessList,
} from '../../utils/api-format';
import { applyQuirkOverlay, resolveInlineQuirks } from '../dispatch/dispatcher-auto-compat';
import { isOAuthRoute } from '../oauth/oauth-dispatcher';
import { resolvePiAiModel } from '../pi-ai/registry';
import { selectTargetApiType } from '../providers/provider-api-selection';
import {
  type CodexReasoningCapabilities,
  getBundledCodexReasoning,
  listCodexOAuthModels,
} from '../providers/provider-model-discovery';
import type { RouteResult } from '../routing/router';

type AccountId = ProviderConfig['oauth_account'];

type Target = {
  route: RouteResult;
  api: string;
  codex: boolean;
};

type Efforts = {
  values: string[];
  supportsConfigurationUpdate: boolean;
};

function normalizeEffort(value: string): string {
  return value === 'none' ? 'off' : value;
}

function directEfforts({ route, api }: Target): string[] {
  const { pi_ai_provider, pi_ai_quirks } = route.config;
  const base = pi_ai_provider
    ? resolvePiAiModel(pi_ai_provider, route.modelConfig?.pi_ai_model_id ?? route.model)
    : null;
  const inline = resolveInlineQuirks(pi_ai_quirks, api, route.model);
  const capability = base ? applyQuirkOverlay(base, pi_ai_quirks, api, route.model) : inline;
  const map = capability?.thinkingLevelMap;
  if (capability?.reasoning !== true) return [];
  const catalogDefaults = base && inline?.thinkingLevelMap === undefined;
  const levels = new Set<string>(Object.keys(map ?? {}));
  if (catalogDefaults) {
    for (const level of getSupportedThinkingLevels(capability)) levels.add(level);
  }
  return Array.from(levels).flatMap((level) => {
    const native = map && Object.hasOwn(map, level) ? map[level] : level;
    return typeof native === 'string' && native.length > 0 ? [normalizeEffort(native)] : [];
  });
}

/** Resolves Responses capabilities for every configured failover, not just today's healthy routes. */
export function createAliasCodexEffortResolver(
  models: Record<string, ModelConfig>,
  providers: Record<string, ProviderConfig>
) {
  const additional = new Map<string, string>();
  for (const [name, model] of Object.entries(models)) {
    for (const alias of model.additional_aliases ?? []) {
      if (!additional.has(alias)) additional.set(alias, name);
    }
  }
  const targets = new Map<string, Target | undefined>();
  const directByTarget = new Map<Target, string[]>();
  const accounts = new Map<AccountId, Promise<Map<string, CodexReasoningCapabilities>>>();

  function resolveTarget(provider: string, model: string): Target | undefined {
    const key = `${provider}\0${model}`;
    if (targets.has(key)) return targets.get(key);
    const config = providers[provider];
    let target: Target | undefined;
    if (config && config.enabled !== false && config.api_base_url) {
      const modelConfig = Array.isArray(config.models) ? undefined : config.models?.[model];
      const types = modelConfig?.access_via?.length
        ? normalizeApiAccessList(modelConfig.access_via)
        : getProviderTypes(config);
      if (
        modelConfig?.type !== 'decisions' &&
        types.length > 0 &&
        !(modelConfig?.access_via?.length && types.every(isDecisionsTargetApiType))
      ) {
        const route = { provider, model, config, modelConfig };
        const { targetApiType } = selectTargetApiType(route, 'responses');
        if (targetApiType && !isImageTargetApiType(targetApiType)) {
          const codex =
            (config.oauth_provider || provider) === 'openai-codex' &&
            isOAuthRoute(route, targetApiType);
          target = { route, api: targetApiType, codex };
        }
      }
    }
    targets.set(key, target);
    return target;
  }

  function collectTargets(aliasId: string): Set<Target> {
    const found = new Set<Target>();
    const visited = new Set<string>();
    const walk = (ref: string): void => {
      const directGroup = /^direct\/([^/]+)\/(.+)$/.exec(ref);
      const name = directGroup?.[1] ?? ref;
      const canonical = Object.hasOwn(models, name) ? name : additional.get(name);
      if (!canonical) return;
      const groupName = directGroup?.[2];
      const key = `${canonical}\0${groupName ?? ''}`;
      if (visited.has(key)) return;
      visited.add(key);
      const alias = models[canonical];
      if (!alias) return;
      for (const group of alias.target_groups ?? []) {
        if (groupName !== undefined && group.name !== groupName) continue;
        for (const target of group.targets) {
          if (target.enabled === false) continue;
          if (target.alias) {
            walk(target.alias);
          } else if (alias.type !== 'decisions' && target.provider && target.model) {
            const resolved = resolveTarget(target.provider, target.model);
            if (resolved) found.add(resolved);
          }
        }
      }
    };
    walk(aliasId);
    return found;
  }

  async function codexEfforts({ route }: Target): Promise<Efforts | undefined> {
    const account = route.config.oauth_account || undefined;
    let lookup = accounts.get(account);
    if (!lookup) {
      lookup = listCodexOAuthModels(account).then(({ models: discovered, source }) => {
        const byModel = new Map<string, CodexReasoningCapabilities>();
        if (source === 'codex-backend') {
          for (const { id, codexReasoning } of discovered) {
            if (codexReasoning) byModel.set(id, codexReasoning);
          }
        }
        return byModel;
      });
      accounts.set(account, lookup);
    }
    const live = (await lookup).get(route.model);
    const capabilities = live ?? getBundledCodexReasoning(route.model);
    if (!capabilities) return undefined;
    return {
      values: capabilities.supportedEfforts.map(normalizeEffort),
      supportsConfigurationUpdate: live?.supportsEffortUpdates === true,
    };
  }

  return async (
    aliasId: string
  ): Promise<{ values?: string[]; supportsConfigurationUpdate: boolean } | undefined> => {
    const candidates = [...collectTargets(aliasId)];
    const codex = candidates.filter((target) => target.codex);
    if (codex.length === 0) return undefined;
    const [first, ...native] = await Promise.all(codex.map(codexEfforts));
    if (!first || !native.every((target) => target !== undefined)) {
      return { supportsConfigurationUpdate: false };
    }
    const direct = candidates
      .filter((target) => !target.codex)
      .map((target) => {
        let values = directByTarget.get(target);
        if (!values) {
          values = directEfforts(target);
          directByTarget.set(target, values);
        }
        return values;
      });
    const values = [...new Set(first.values)].filter(
      (value) =>
        native.every((target) => target.values.includes(value)) &&
        direct.every((levels) => levels.includes(value))
    );
    return {
      values,
      // Only live account metadata can confirm support for configuration updates.
      supportsConfigurationUpdate:
        direct.length === 0 &&
        first.supportsConfigurationUpdate &&
        native.every((target) => target.supportsConfigurationUpdate),
    };
  };
}
