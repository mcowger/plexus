import { ProviderType, ProviderConfig, ProviderClient } from '@plexus/types';
import {LanguageModel} from 'ai'
import { createAnthropic, AnthropicProvider, AnthropicProviderSettings } from '@ai-sdk/anthropic'

export class AnthropicProviderClient implements ProviderClient {
  public readonly type: ProviderType = 'anthropic';
  readonly config: ProviderConfig
  readonly providerInstance: AnthropicProvider

  constructor(config: ProviderConfig) {
    this.config = config;
    this.providerInstance = createAnthropic(
      {
        apiKey: config.apiKey,
        ...(config.baseURL && { baseURL: config.baseURL }),
        ...(config.headers && { headers: config.headers })
      } as AnthropicProviderSettings
    )
  }

  getModel(modelId: string): LanguageModel {
    return this.providerInstance(modelId);
  }
}