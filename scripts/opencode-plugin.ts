import type { Plugin, ProviderConfig } from "@opencode-ai/plugin"

interface PlexusModel {
  id: string
  name?: string
  description?: string
  context_length?: number
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
    tokenizer?: string
  }
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
    input_cache_write?: string
  }
  supported_parameters?: string[]
  top_provider?: {
    context_length?: number
    max_completion_tokens?: number
  }
}

interface PlexusAlias {
  targets?: Array<{ provider: string; model: string; enabled?: boolean }>
  selector?: string
  priority?: string
  use_image_fallthrough?: boolean
  additional_aliases?: string[]
  metadata?: {
    source?: string
    source_path?: string
    overrides?: {
      name?: string
      description?: string
      context_length?: number
      pricing?: {
        prompt?: string
        completion?: string
        input_cache_read?: string
        input_cache_write?: string
      }
      architecture?: {
        input_modalities?: string[]
        output_modalities?: string[]
        tokenizer?: string
      }
      supported_parameters?: string[]
    }
  }
  type?: string
  model_architecture?: {
    total_params?: number
    active_params?: number
    layers?: number
    heads?: number
    kv_lora_rank?: number
    qk_rope_head_dim?: number
    context_length?: number
    dtype?: string
  }
}

interface PlexusModelsResponse {
  object: string
  data: PlexusModel[]
}

function findPlexusProvider(config: Record<string, unknown>): { name: string; cfg: ProviderConfig; baseUrl: string } | null {
  const providers = config.provider as Record<string, unknown> | undefined
  if (!providers) return null

  for (const [name, p] of Object.entries(providers)) {
    const cfg = p as ProviderConfig
    if (!cfg.api || typeof cfg.api !== "string") continue

    if (name === "plexus" || cfg.api.toLowerCase().includes("plexus") || cfg.name?.toLowerCase() === "plexus") {
      return { name, cfg, baseUrl: cfg.api.replace(/\/+$/, "") }
    }
  }
  return null
}

function resolveApiKey(cfg: ProviderConfig): string | undefined {
  // Check options.apiKey first
  const optionsKey = (cfg.options as Record<string, unknown> | undefined)?.apiKey
  if (typeof optionsKey === "string" && optionsKey) return optionsKey

  // Fall back to env vars listed in the provider config
  if (cfg.env) {
    for (const envVar of cfg.env) {
      const val = process.env[envVar]
      if (val) return val
    }
  }

  return undefined
}

function parsePrice(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseFloat(value)
  return Number.isNaN(n) ? undefined : n
}

function mapFromPublicModel(model: PlexusModel): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: model.id,
    name: model.name ?? model.id,
  }

  const contextLength = model.context_length ?? model.top_provider?.context_length
  const maxOutput = model.top_provider?.max_completion_tokens ?? contextLength
  if (contextLength || maxOutput) {
    entry.limit = {
      context: contextLength ?? maxOutput ?? 0,
      output: maxOutput ?? contextLength ?? 0,
    }
  }

  const inputModalities = model.architecture?.input_modalities
  const outputModalities = model.architecture?.output_modalities
  if (inputModalities || outputModalities) {
    const modalities: Record<string, string[]> = {}
    if (inputModalities) modalities.input = inputModalities
    if (outputModalities) modalities.output = outputModalities
    entry.modalities = modalities
  }

  if (inputModalities?.some((m) => m === "image" || m === "pdf")) {
    entry.attachment = true
  }

  if (model.pricing) {
    const cost: Record<string, unknown> = {}
    const inputCost = parsePrice(model.pricing.prompt)
    const outputCost = parsePrice(model.pricing.completion)
    if (inputCost !== undefined) cost.input = inputCost
    if (outputCost !== undefined) cost.output = outputCost

    const cacheRead = parsePrice(model.pricing.input_cache_read)
    const cacheWrite = parsePrice(model.pricing.input_cache_write)
    if (cacheRead !== undefined || cacheWrite !== undefined) {
      cost.cache = {
        ...(cacheRead !== undefined && { read: cacheRead }),
        ...(cacheWrite !== undefined && { write: cacheWrite }),
      }
    }

    if (Object.keys(cost).length > 0) entry.cost = cost
  }

  const params = model.supported_parameters ?? []
  if (params.includes("temperature")) entry.temperature = true
  if (params.includes("tools") || params.includes("tool_choice") || params.includes("function_calling")) {
    entry.tool_call = true
  }

  const supportsThinking = params.some((p) => p === "thinking" || p === "reasoning" || p === "reasoning_effort")
  if (supportsThinking) {
    entry.variants = {
      default: {},
      thinking: { reasoning: true },
    }
  }

  return entry
}

function mapFromAlias(aliasId: string, alias: PlexusAlias): Record<string, unknown> {
  const meta = alias.metadata?.overrides
  const entry: Record<string, unknown> = {
    id: aliasId,
    name: meta?.name ?? aliasId,
  }

  const contextLength = meta?.context_length ?? alias.model_architecture?.context_length
  if (contextLength) {
    entry.limit = { context: contextLength, output: contextLength }
  }

  const inputModalities = meta?.architecture?.input_modalities
  const outputModalities = meta?.architecture?.output_modalities
  if (inputModalities || outputModalities) {
    const modalities: Record<string, string[]> = {}
    if (inputModalities) modalities.input = inputModalities
    if (outputModalities) modalities.output = outputModalities
    entry.modalities = modalities
  }

  // Vision fallthrough means this alias effectively supports image input
  if (alias.use_image_fallthrough) {
    entry.attachment = true
    if (inputModalities && !inputModalities.includes("image")) {
      const modalities = (entry.modalities as Record<string, string[]> | undefined) ?? {}
      modalities.input = [...(modalities.input ?? []), "image"]
      entry.modalities = modalities
    }
  } else if (inputModalities?.some((m) => m === "image" || m === "pdf")) {
    entry.attachment = true
  }

  if (meta?.pricing) {
    const cost: Record<string, unknown> = {}
    const inputCost = parsePrice(meta.pricing.prompt)
    const outputCost = parsePrice(meta.pricing.completion)
    if (inputCost !== undefined) cost.input = inputCost
    if (outputCost !== undefined) cost.output = outputCost

    const cacheRead = parsePrice(meta.pricing.input_cache_read)
    const cacheWrite = parsePrice(meta.pricing.input_cache_write)
    if (cacheRead !== undefined || cacheWrite !== undefined) {
      cost.cache = {
        ...(cacheRead !== undefined && { read: cacheRead }),
        ...(cacheWrite !== undefined && { write: cacheWrite }),
      }
    }

    if (Object.keys(cost).length > 0) entry.cost = cost
  }

  const params = meta?.supported_parameters ?? []
  if (params.includes("temperature")) entry.temperature = true
  if (params.includes("tools") || params.includes("tool_choice") || params.includes("function_calling")) {
    entry.tool_call = true
  }

  const supportsThinking = params.some((p) => p === "thinking" || p === "reasoning" || p === "reasoning_effort")
  if (supportsThinking) {
    entry.variants = {
      default: {},
      thinking: { reasoning: true },
    }
  }

  return entry
}

export const PlexusPlugin: Plugin = async () => {
  const LOG = "[plexus-plugin]"

  return {
    auth: {
      provider: "plexus",
      methods: [
        {
          type: "api",
          label: "API Key",
          prompts: [
            {
              type: "text",
              key: "apiKey",
              message: "Enter your Plexus API key",
              placeholder: "sk-...",
            },
          ],
          authorize: async (inputs) => {
            if (!inputs?.apiKey) return { type: "failed" }
            return { type: "success", key: inputs.apiKey, provider: "plexus" }
          },
        },
      ],
    },

    config: async (config) => {
      const provider = findPlexusProvider(config as unknown as Record<string, unknown>)
      if (!provider) {
        console.warn(`${LOG} No plexus provider found in config — skipping model sync`)
        return
      }

      const { name: providerName, cfg, baseUrl } = provider

      // Resolve an API key for management endpoints (x-admin-key header).
      // The provider env vars or options.apiKey are checked; inference auth
      // from auth.json is handled separately by the opencode runtime.
      const apiKey = resolveApiKey(cfg)
      const authHeaders: Record<string, string> = apiKey ? { "x-admin-key": apiKey } : {}

      // ── Try the read-only management aliases endpoint first ────────────
      // This endpoint (in the user's fork) only requires authenticate, not
      // admin, and returns the full alias config including use_image_fallthrough.
      let aliases: Record<string, PlexusAlias> | null = null
      try {
        const res = await fetch(`${baseUrl.replace(/\/v1$/, "")}/v0/management/aliases`, {
          headers: authHeaders,
        })
        if (res.ok) {
          aliases = (await res.json()) as Record<string, PlexusAlias>
        }
      } catch {
        // fall through to public endpoint
      }

      let modelsConfig: Record<string, unknown>

      if (aliases && Object.keys(aliases).length > 0) {
        modelsConfig = {}
        for (const [aliasId, alias] of Object.entries(aliases)) {
          modelsConfig[aliasId] = mapFromAlias(aliasId, alias)
        }
      } else {
        // ── Fall back to the public /v1/models endpoint ─────────────────
        const res = await fetch(`${baseUrl}/models`).catch(() => null)
        if (!res?.ok) {
          console.warn(`${LOG} Could not reach ${baseUrl}/models — skipping model sync`)
          return
        }

        let body: PlexusModelsResponse
        try {
          body = (await res.json()) as PlexusModelsResponse
        } catch {
          console.warn(`${LOG} Invalid JSON from ${baseUrl}/models — skipping model sync`)
          return
        }

        const models = body?.data ?? []
        if (!models.length) {
          console.warn(`${LOG} No models returned from ${baseUrl}/models — skipping`)
          return
        }

        modelsConfig = {}
        for (const m of models) {
          modelsConfig[m.id] = mapFromPublicModel(m)
        }
      }

      const providers = (config.provider ?? {}) as Record<string, unknown>
      const existing = (providers[providerName] as Record<string, unknown> | undefined) ?? {}
      const existingModels = (existing.models as Record<string, unknown> | undefined) ?? {}

      providers[providerName] = {
        ...existing,
        models: { ...existingModels, ...modelsConfig },
      }

      if (!config.provider) config.provider = {} as Record<string, ProviderConfig>
      Object.assign(config.provider, providers)
    },
  }
}
