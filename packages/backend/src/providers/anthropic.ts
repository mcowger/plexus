import { ProviderType, ProviderConfig } from '@plexus/types';
import { createAnthropic } from '@ai-sdk/anthropic'
import { BaseProviderClient } from './base.js';

export class AnthropicProviderClient extends BaseProviderClient {
  public readonly type: ProviderType = 'anthropic';
  private anthropic: any;

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected initializeModel(): void {
    // Use OpenAI-compatible provider for Anthropic
    this.anthropic = createAnthropic({
      name: 'anthropic',
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL || 'https://api.anthropic.com/v1',
    });

    const modelName = this.config.model || 'claude-3-haiku-20240307';
    this.model = this.anthropic(modelName);
  }
}