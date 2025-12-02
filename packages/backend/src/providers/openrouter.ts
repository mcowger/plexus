import { ProviderType, ProviderConfig } from '@plexus/types';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { BaseProviderClient } from './base.js';

export class OpenRouterProviderClient extends BaseProviderClient {
  public readonly type: ProviderType = 'openrouter';
  private openrouter: any;

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected initializeModel(): void {
    this.openrouter = createOpenRouter({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
    });

    const modelName = this.config.model || 'openai/gpt-3.5-turbo';
    this.model = this.openrouter(modelName);
  }
}