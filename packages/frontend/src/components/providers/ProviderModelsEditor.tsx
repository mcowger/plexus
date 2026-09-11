import { useState } from 'react';
import type { Provider } from '../../lib/api';
import { ModelList } from './model-editor/ModelList';
import { renameRecordKey, removeRecordKey } from './model-editor/adapter-utils';
import { CODEX_OAUTH_PROVIDER } from './model-editor/constants';
import { usePiAiModels } from './model-editor/usePiAiModels';

interface Props {
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  isModelsOpen: boolean;
  setIsModelsOpen: (v: boolean) => void;
  openModelIdx: string | null;
  setOpenModelIdx: (v: string | null) => void;
  isModelExtraBodyOpen: Record<string, boolean>;
  setIsModelExtraBodyOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  testStates: Record<
    string,
    {
      loading: boolean;
      result?: 'success' | 'error';
      message?: string;
      showResult: boolean;
      showMessage?: boolean;
    }
  >;
  onDismissTestMessage: (testKey: string) => void;
  addModel: () => void;
  updateModelId: (oldId: string, newId: string) => void;
  updateModelConfig: (modelId: string, updates: any) => void;
  removeModel: (modelId: string) => void;
  addModelKV: (modelId: string) => void;
  updateModelKV: (modelId: string, oldKey: string, newKey: string, value: any) => void;
  removeModelKV: (modelId: string, key: string) => void;
  onOpenFetchModels: () => void;
  onTestModel: (providerId: string, modelId: string, modelType?: string) => void;
  getApiBaseUrlMap: () => Record<string, string>;
  isNewProvider: boolean;
  isOAuthMode: boolean;
}

export function ProviderModelsEditor({
  editingProvider,
  setEditingProvider: _setEditingProvider,
  isModelsOpen,
  setIsModelsOpen,
  openModelIdx,
  setOpenModelIdx,
  isModelExtraBodyOpen,
  setIsModelExtraBodyOpen,
  testStates,
  addModel,
  updateModelId,
  updateModelConfig,
  removeModel,
  addModelKV,
  updateModelKV,
  removeModelKV,
  onOpenFetchModels,
  onTestModel,
  onDismissTestMessage,
  getApiBaseUrlMap,
  isNewProvider,
  isOAuthMode,
}: Props) {
  const [modelAdaptersOpen, setModelAdaptersOpen] = useState<Record<string, boolean>>({});
  const [modelAdvancedOpen, setModelAdvancedOpen] = useState<Record<string, boolean>>({});
  const piAiModels = usePiAiModels(editingProvider.pi_ai_provider, editingProvider.models);

  const isCodexOAuthProvider =
    isOAuthMode && editingProvider.oauthProvider === CODEX_OAUTH_PROVIDER;

  const handleUpdateModelId = (oldId: string, newId: string) => {
    if (oldId === newId) return;
    setModelAdaptersOpen((prev) => renameRecordKey(prev, oldId, newId));
    setModelAdvancedOpen((prev) => renameRecordKey(prev, oldId, newId));
    piAiModels.renameModelId(oldId, newId);
    updateModelId(oldId, newId);
  };

  const handleRemoveModel = (modelId: string) => {
    setModelAdaptersOpen((prev) => removeRecordKey(prev, modelId));
    setModelAdvancedOpen((prev) => removeRecordKey(prev, modelId));
    piAiModels.removeModelId(modelId);
    removeModel(modelId);
  };

  return (
    <ModelList
      editingProvider={editingProvider}
      isModelsOpen={isModelsOpen}
      setIsModelsOpen={setIsModelsOpen}
      openModelIdx={openModelIdx}
      setOpenModelIdx={setOpenModelIdx}
      isModelExtraBodyOpen={isModelExtraBodyOpen}
      setIsModelExtraBodyOpen={setIsModelExtraBodyOpen}
      testStates={testStates}
      addModel={addModel}
      updateModelConfig={updateModelConfig}
      addModelKV={addModelKV}
      updateModelKV={updateModelKV}
      removeModelKV={removeModelKV}
      onOpenFetchModels={onOpenFetchModels}
      onTestModel={onTestModel}
      onDismissTestMessage={onDismissTestMessage}
      getApiBaseUrlMap={getApiBaseUrlMap}
      isNewProvider={isNewProvider}
      modelAdaptersOpen={modelAdaptersOpen}
      setModelAdaptersOpen={setModelAdaptersOpen}
      modelAdvancedOpen={modelAdvancedOpen}
      setModelAdvancedOpen={setModelAdvancedOpen}
      piAiProvider={editingProvider.pi_ai_provider}
      piModels={piAiModels.piModels}
      piModelCustom={piAiModels.piModelCustom}
      setPiModelCustom={piAiModels.setPiModelCustom}
      onUpdateModelId={handleUpdateModelId}
      onRemoveModel={handleRemoveModel}
      isCodexOAuthProvider={isCodexOAuthProvider}
    />
  );
}
