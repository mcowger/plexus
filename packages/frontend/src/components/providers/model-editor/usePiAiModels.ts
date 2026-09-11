import { useEffect, useState } from 'react';
import type { Provider } from '../../../lib/api';
import { api } from '../../../lib/api';
import { renameRecordKey, removeRecordKey } from './adapter-utils';

export interface PiAiModel {
  id: string;
  name: string;
  api: string;
  custom: boolean;
}

export function usePiAiModels(
  piAiProvider: string | undefined,
  providerModels: Provider['models']
) {
  const [piModels, setPiModels] = useState<PiAiModel[]>([]);
  const [piModelCustom, setPiModelCustom] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!piAiProvider) {
      setPiModels([]);
      return;
    }
    api
      .getPiModels(piAiProvider)
      .then(setPiModels)
      .catch(() => setPiModels([]));
  }, [piAiProvider]);

  useEffect(() => {
    if (piModels.length === 0) return;
    const modelIds = new Set(piModels.map((model) => model.id));
    const models = providerModels && !Array.isArray(providerModels) ? providerModels : undefined;
    if (!models) return;
    const updates: Record<string, boolean> = {};
    for (const [modelId, modelConfig] of Object.entries(models)) {
      const piId = modelConfig.pi_ai_model_id;
      if (piId && !modelIds.has(piId)) updates[modelId] = true;
    }
    if (Object.keys(updates).length > 0) {
      setPiModelCustom((prev) => ({ ...prev, ...updates }));
    }
  }, [piModels, providerModels]);

  const renameModelId = (oldId: string, newId: string) => {
    setPiModelCustom((prev) => renameRecordKey(prev, oldId, newId));
  };

  const removeModelId = (modelId: string) => {
    setPiModelCustom((prev) => removeRecordKey(prev, modelId));
  };

  return {
    piModels,
    piModelCustom,
    setPiModelCustom,
    renameModelId,
    removeModelId,
  };
}
