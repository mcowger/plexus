import { ChevronDown, ChevronRight, Download, Plus } from 'lucide-react';
import type { Provider } from '../../../lib/api';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ModelCard } from './ModelCard';
import type { ModelConfig, ModelTestState } from './types';
import type { PiAiModel } from './usePiAiModels';

interface Props {
  editingProvider: Provider;
  isModelsOpen: boolean;
  setIsModelsOpen: (value: boolean) => void;
  openModelIdx: string | null;
  setOpenModelIdx: (value: string | null) => void;
  isModelExtraBodyOpen: Record<string, boolean>;
  setIsModelExtraBodyOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  testStates: Record<string, ModelTestState>;
  addModel: () => void;
  updateModelConfig: (modelId: string, updates: any) => void;
  addModelKV: (modelId: string) => void;
  updateModelKV: (modelId: string, oldKey: string, newKey: string, value: any) => void;
  removeModelKV: (modelId: string, key: string) => void;
  onOpenFetchModels: () => void;
  onTestModel: (providerId: string, modelId: string, modelType?: string) => void;
  onDismissTestMessage: (testKey: string) => void;
  getApiBaseUrlMap: () => Record<string, string>;
  isNewProvider: boolean;
  modelAdaptersOpen: Record<string, boolean>;
  setModelAdaptersOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  modelAdvancedOpen: Record<string, boolean>;
  setModelAdvancedOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  piAiProvider?: string;
  piModels: PiAiModel[];
  piModelCustom: Record<string, boolean>;
  setPiModelCustom: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onUpdateModelId: (oldId: string, newId: string) => void;
  onRemoveModel: (modelId: string) => void;
  isCodexOAuthProvider: boolean;
}

export function ModelList({
  editingProvider,
  isModelsOpen,
  setIsModelsOpen,
  openModelIdx,
  setOpenModelIdx,
  isModelExtraBodyOpen,
  setIsModelExtraBodyOpen,
  testStates,
  addModel,
  updateModelConfig,
  addModelKV,
  updateModelKV,
  removeModelKV,
  onOpenFetchModels,
  onTestModel,
  onDismissTestMessage,
  getApiBaseUrlMap,
  isNewProvider,
  modelAdaptersOpen,
  setModelAdaptersOpen,
  modelAdvancedOpen,
  setModelAdvancedOpen,
  piAiProvider,
  piModels,
  piModelCustom,
  setPiModelCustom,
  onUpdateModelId,
  onRemoveModel,
  isCodexOAuthProvider,
}: Props) {
  return (
    <div className="border border-border-glass rounded-md">
      <div
        className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
        onClick={() => setIsModelsOpen(!isModelsOpen)}
      >
        {isModelsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>Provider Models</span>
        <Badge status="connected">{Object.keys(editingProvider.models || {}).length} Models</Badge>
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFetchModels();
          }}
          leftIcon={<Download size={14} />}
          style={{ marginLeft: '8px' }}
        >
          Fetch Models
        </Button>
      </div>
      {isModelsOpen && (
        <div
          style={{
            padding: '8px',
            borderTop: '1px solid var(--color-border-glass)',
            background: 'var(--color-bg-subtle)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={addModel}>
              Add Model
            </Button>
            {Object.entries(editingProvider.models || {}).map(([modelId, rawModelConfig]) => {
              const modelConfig = rawModelConfig as ModelConfig;
              return (
                <ModelCard
                  key={modelId}
                  providerId={editingProvider.id}
                  modelId={modelId}
                  modelConfig={modelConfig}
                  testState={testStates[`${editingProvider.id}-${modelId}`]}
                  isNewProvider={isNewProvider}
                  isOpen={openModelIdx === modelId}
                  setIsOpen={(open) => setOpenModelIdx(open ? modelId : null)}
                  onTestModel={onTestModel}
                  onDismissTestMessage={onDismissTestMessage}
                  onRemoveModel={onRemoveModel}
                  onUpdateModelId={onUpdateModelId}
                  updateModelConfig={updateModelConfig}
                  modelAdaptersOpen={modelAdaptersOpen[modelId] ?? false}
                  setModelAdaptersOpen={(open) =>
                    setModelAdaptersOpen((prev) => ({ ...prev, [modelId]: open }))
                  }
                  modelAdvancedOpen={modelAdvancedOpen[modelId] ?? false}
                  setModelAdvancedOpen={(open) =>
                    setModelAdvancedOpen((prev) => ({ ...prev, [modelId]: open }))
                  }
                  modelExtraBodyOpen={isModelExtraBodyOpen[modelId] ?? false}
                  setModelExtraBodyOpen={(open) =>
                    setIsModelExtraBodyOpen((prev) => ({ ...prev, [modelId]: open }))
                  }
                  addModelKV={addModelKV}
                  updateModelKV={updateModelKV}
                  removeModelKV={removeModelKV}
                  piAiProvider={piAiProvider}
                  piModels={piModels}
                  piModelCustom={piModelCustom}
                  setPiModelCustom={setPiModelCustom}
                  isCodexOAuthProvider={isCodexOAuthProvider}
                  getApiBaseUrlMap={getApiBaseUrlMap}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
