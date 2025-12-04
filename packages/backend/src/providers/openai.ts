import { ProviderType, ProviderConfig, ProviderClient, ChatCompletionRequest, ModelConfig} from '@plexus/types';
import {GenerateTextResult, ToolSet, generateText} from 'ai'
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

  async chatCompletion(request: ChatCompletionRequest, modelConfig: ModelConfig): Promise<GenerateTextResult<ToolSet, never>> {
    const model = this.providerInstance(modelConfig.canonical_slug || modelConfig.display_slug)
    let result = await generateText({
      model,
      messages: request.messages
    })
    return result
  }
}