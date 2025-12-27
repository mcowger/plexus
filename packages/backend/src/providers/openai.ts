import { ProviderType, ProviderConfig, ProviderClient} from '@plexus/types';
import {LanguageModel} from 'ai'
import { createOpenAI, OpenAIProvider, OpenAIProviderSettings } from '@ai-sdk/openai';

export class OpenAIProviderClient implements ProviderClient {
  public readonly type: ProviderType = 'openai';
  readonly config: ProviderConfig
  readonly providerInstance: OpenAIProvider

  constructor(config: ProviderConfig) {
    this.config = config;
    this.providerInstance = createOpenAI(
      {
        apiKey: config.apiKey,
        ...(config.baseURL && { baseURL: config.baseURL }),
        ...(config.headers && { headers: config.headers })
      } as OpenAIProviderSettings
    )
  }

  getModel(modelId: string): LanguageModel {
    return this.providerInstance(modelId);
  }

}