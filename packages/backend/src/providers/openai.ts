import { ProviderType, ProviderConfig } from '@plexus/types';
import { createOpenAI } from '@ai-sdk/openai';
import { BaseProviderClient } from './base.js';

export class OpenAIProviderClient extends BaseProviderClient {
  public readonly type: ProviderType = 'openai';
  private openai: any;

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected initializeModel(): void {
    this.openai = createOpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
    });

    const modelName = this.config.model || 'gpt-3.5-turbo';
    this.model = this.openai(modelName);
  }
}