import { parse, stringify } from 'yaml';
import { client, type paths, type components } from './api-client';

interface DeleteLogsRequest {
  type?: 'usage' | 'error' | 'trace';
  olderThanDays?: number;
  all?: boolean;
}

export const api = {
  getConfig: async (): Promise<string> => {
    const { data, error } = await client.GET('/config');
    if (error) throw new Error(String(error));
    if (!data?.config) throw new Error('Config data missing');
    return data.config;
  },

  updateConfig: async (config: string): Promise<void> => {
    const { data, error } = await client.POST('/config', {
      body: {
        config,
        hotReload: true,
      },
    });
    if (error) throw new Error(String(error));
  },

  getState: async (): Promise<components['schemas']['StateGetResponse']> => {
    const { data, error } = await client.GET('/state');
    if (error) throw new Error(String(error));
    if (!data) throw new Error('State data missing');
    return data;
  },

  updateState: async (
    action: components['schemas']['SetDebugAction'] | components['schemas']['ClearCooldownsAction'] | components['schemas']['EnableProviderAction'] | components['schemas']['DisableProviderAction']
  ): Promise<components['schemas']['StateGetResponse']> => {
    const { data, error } = await client.POST('/state', {
      body: action,
    });
    if (error) throw new Error(String(error));
    if (!data?.state) throw new Error('State data missing');
    return data.state;
  },

  queryLogs: async (params?: paths['/logs']['get']['parameters']['query']): Promise<
    paths['/logs']['get']['responses'][200]['content']['application/json']
  > => {
    const { data, error } = await client.GET('/logs', {
      params: params ? { query: params } : undefined,
    });
    if (error) throw new Error(String(error));
    if (!data) throw new Error('Logs data missing');
    return data;
  },

  deleteLogs: async (body?: DeleteLogsRequest): Promise<
    paths['/logs']['delete']['responses'][200]['content']['application/json']
  > => {
    const { data, error } = await client.DELETE('/logs', {
      body: body as components['requestBodies']['deleteLogs'] || {},
    });
    if (error) throw new Error(String(error));
    if (!data) throw new Error('Delete logs data missing');
    return data;
  },

  deleteLogById: async (id: string): Promise<{ success: boolean; deleted: { usage: boolean; error: boolean; trace: boolean } }> => {
    const { data, error } = await client.DELETE('/logs/{id}', {
      params: {
        path: { id },
      },
    });
    if (error) throw new Error(String(error));
    if (!data) throw new Error('Delete log data missing');
    return data as { success: boolean; deleted: { usage: boolean; error: boolean; trace: boolean } };
  },

  getLogDetails: async (id: string) => {
    const { data, error } = await client.GET('/logs/{id}', {
      params: {
        path: { id },
      },
    });
    if (error) throw new Error(String(error));
    if (!data) throw new Error('Log details data missing');
    
    // Extract traces if present and format them properly
    if (data.traces && data.traces.length > 0) {
      return {
      ...data,
        traces: data.traces.map((trace: any) => ({
          ...trace,
          // Ensure stream chunks are properly typed as strings
          providerStreamChunks: trace.providerStreamChunks?.map((item: any) => ({
            timestamp: item.timestamp,
            chunk: typeof item.chunk === 'string' ? item.chunk : JSON.stringify(item.chunk),
          })) || [],
          clientStreamChunks: trace.clientStreamChunks?.map((item: any) => ({
            timestamp: item.timestamp,
            chunk: typeof item.chunk === 'string' ? item.chunk : JSON.stringify(item.chunk),
          })) || [],
        }))
      };
    }
    
    return data;
  },
};
