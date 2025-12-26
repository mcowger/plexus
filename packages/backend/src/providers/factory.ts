import { ProviderType, ProviderConfig, ProviderClient } from '@plexus/types';
import { OpenAIProviderClient } from './openai.js';
import { AnthropicProviderClient } from './anthropic.js';

export class ProviderFactory {
  private static instances: Map<string, ProviderClient> = new Map();

  static createClient(config: ProviderConfig): ProviderClient {
    const key = `${config.type}-${config.apiKey}`;
    
    if (this.instances.has(key)) {
      return this.instances.get(key)!;
    }

    let client: ProviderClient;

    switch (config.type) {
      case 'openai':
        client = new OpenAIProviderClient(config);
        break;
      case 'anthropic':
        client = new AnthropicProviderClient(config);
        break;
      default:
        throw new Error(`Unsupported provider type: ${config.type}`);
    }

    this.instances.set(key, client);
    return client;
  }

  static getClient(type: ProviderType, apiKey: string): ProviderClient {
    const config: ProviderConfig = {
      type,
      apiKey
    };

    return this.createClient(config);
  }

  static clearCache(): void {
    this.instances.clear();
  }

  static getCachedClients(): ProviderClient[] {
    return Array.from(this.instances.values());
  }
}