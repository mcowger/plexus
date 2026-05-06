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

function parsePrice(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseFloat(value)
  return Number.isNaN(n) ? undefined : n
}

function mapModel(model: PlexusModel): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: model.id,
    name: model.name ?? model.id,
  }

  // Context and output limits
  const contextLength = model.context_length ?? model.top_provider?.context_length
  const maxOutput = model.top_provider?.max_completion_tokens ?? contextLength
  if (contextLength || maxOutput) {
    entry.limit = {
      context: contextLength ?? maxOutput ?? 0,
      output: maxOutput ?? contextLength ?? 0,
    }
  }

  // Input/output modalities
  const inputModalities = model.architecture?.input_modalities
  const outputModalities = model.architecture?.output_modalities
  if (inputModalities || outputModalities) {
    const modalities: Record<string, string[]> = {}
    if (inputModalities) modalities.input = inputModalities
    if (outputModalities) modalities.output = outputModalities
    entry.modalities = modalities
  }

  // Attachment support from multimodal input
  if (inputModalities?.some((m) => m === "image" || m === "pdf")) {
    entry.attachment = true
  }

  // Pricing
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

  // Capabilities derived from supported_parameters
  const params = model.supported_parameters ?? []
  if (params.includes("temperature")) entry.temperature = true
  if (params.includes("tools") || params.includes("tool_choice") || params.includes("function_calling")) {
    entry.tool_call = true
  }

  // Thinking variants for models that support reasoning
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
      const modelsUrl = `${baseUrl}/models`

      let res: Response
      try {
        res = await fetch(modelsUrl)
      } catch (err) {
        console.warn(`${LOG} Could not reach ${modelsUrl} — skipping model sync (${(err as Error).message})`)
        return
      }

      if (!res.ok) {
        console.warn(`${LOG} GET ${modelsUrl} returned ${res.status} — skipping model sync`)
        return
      }

      let body: PlexusModelsResponse
      try {
        body = (await res.json()) as PlexusModelsResponse
      } catch {
        console.warn(`${LOG} Invalid JSON from ${modelsUrl} — skipping model sync`)
        return
      }

      const models = body?.data ?? []
      if (!models.length) {
        console.warn(`${LOG} No models returned from ${modelsUrl} — skipping`)
        return
      }

      const modelsConfig: Record<string, unknown> = {}
      for (const m of models) {
        modelsConfig[m.id] = mapModel(m)
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
