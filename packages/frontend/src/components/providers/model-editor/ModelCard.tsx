import { CheckCircle, ChevronDown, ChevronRight, Loader2, Play, X, XCircle } from 'lucide-react';
import { CopyButton } from '../../ui/CopyButton';
import { Button } from '../../ui/Button';
import { ModelAdapters } from './ModelAdapters';
import { ModelAdvanced } from './ModelAdvanced';
import { ModelExtraBody } from './ModelExtraBody';
import { ModelIdentity } from './ModelIdentity';
import { ModelPricing } from './ModelPricing';
import type { ModelConfig, ModelTestState } from './types';
import type { PiAiModel } from './usePiAiModels';

interface Props {
  providerId: string;
  modelId: string;
  modelConfig: ModelConfig;
  testState?: ModelTestState;
  isNewProvider: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  onTestModel: (providerId: string, modelId: string, modelType?: string) => void;
  onDismissTestMessage: (testKey: string) => void;
  onRemoveModel: (modelId: string) => void;
  onUpdateModelId: (oldId: string, newId: string) => void;
  updateModelConfig: (modelId: string, updates: any) => void;
  modelAdaptersOpen: boolean;
  setModelAdaptersOpen: (open: boolean) => void;
  modelAdvancedOpen: boolean;
  setModelAdvancedOpen: (open: boolean) => void;
  modelExtraBodyOpen: boolean;
  setModelExtraBodyOpen: (open: boolean) => void;
  addModelKV: (modelId: string) => void;
  updateModelKV: (modelId: string, oldKey: string, newKey: string, value: any) => void;
  removeModelKV: (modelId: string, key: string) => void;
  piAiProvider?: string;
  piModels: PiAiModel[];
  piModelCustom: Record<string, boolean>;
  setPiModelCustom: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isCodexOAuthProvider: boolean;
  getApiBaseUrlMap: () => Record<string, string>;
}

export function ModelCard({
  providerId,
  modelId,
  modelConfig,
  testState,
  isNewProvider,
  isOpen,
  setIsOpen,
  onTestModel,
  onDismissTestMessage,
  onRemoveModel,
  onUpdateModelId,
  updateModelConfig,
  modelAdaptersOpen,
  setModelAdaptersOpen,
  modelAdvancedOpen,
  setModelAdvancedOpen,
  modelExtraBodyOpen,
  setModelExtraBodyOpen,
  addModelKV,
  updateModelKV,
  removeModelKV,
  piAiProvider,
  piModels,
  piModelCustom,
  setPiModelCustom,
  isCodexOAuthProvider,
  getApiBaseUrlMap,
}: Props) {
  const testKey = `${providerId}-${modelId}`;

  return (
    <div
      style={{
        border: '1px solid var(--color-border-glass)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-surface)',
      }}
    >
      <div
        style={{
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ fontWeight: 600, fontSize: '12px', flex: 1 }}>{modelId}</span>
        <div
          onClick={(e) => {
            if (isNewProvider) return;
            e.stopPropagation();
            onTestModel(providerId, modelId, modelConfig.type);
          }}
          className={
            isNewProvider
              ? 'flex items-center cursor-not-allowed opacity-40'
              : 'flex items-center cursor-pointer'
          }
          title={isNewProvider ? 'Save the provider first to probe models' : 'Test this model'}
        >
          {testState?.loading ? (
            <Loader2 size={14} className="animate-spin text-text-secondary" />
          ) : testState?.showResult && testState.result === 'success' ? (
            <CheckCircle size={14} className="text-success" />
          ) : testState?.showResult && testState.result === 'error' ? (
            <XCircle size={14} className="text-danger" />
          ) : (
            <Play size={14} className="text-primary opacity-60" />
          )}
        </div>
        <CopyButton value={`direct/${providerId}/${modelId}`} size="sm" className="mr-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveModel(modelId);
          }}
          style={{ color: 'var(--color-danger)', padding: '2px' }}
        >
          <X size={12} />
        </Button>
      </div>
      {testState?.showMessage && testState.result === 'error' && testState.message && (
        <div style={{ padding: '0 8px 6px 8px' }}>
          <div
            onClick={(e) => {
              e.stopPropagation();
              onDismissTestMessage(testKey);
            }}
            className="cursor-pointer rounded border border-danger/30 bg-danger/10 px-2 py-1"
            title="Click to dismiss"
          >
            <span className="text-[11px] italic text-danger">{testState.message} [×]</span>
          </div>
        </div>
      )}

      {isOpen && (
        <div
          style={{
            padding: '8px',
            borderTop: '1px solid var(--color-border-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              alignItems: 'start',
            }}
          >
            <ModelIdentity
              modelId={modelId}
              modelConfig={modelConfig}
              updateModelConfig={updateModelConfig}
              onUpdateModelId={onUpdateModelId}
              piAiProvider={piAiProvider}
              piModels={piModels}
              piModelCustom={piModelCustom}
              setPiModelCustom={setPiModelCustom}
              isCodexOAuthProvider={isCodexOAuthProvider}
              getApiBaseUrlMap={getApiBaseUrlMap}
            />
            <ModelPricing
              modelId={modelId}
              modelConfig={modelConfig}
              updateModelConfig={updateModelConfig}
            />
          </div>
          <ModelAdapters
            modelId={modelId}
            modelConfig={modelConfig}
            isOpen={modelAdaptersOpen}
            setIsOpen={setModelAdaptersOpen}
            updateModelConfig={updateModelConfig}
          />
          <ModelExtraBody
            modelId={modelId}
            modelConfig={modelConfig}
            isOpen={modelExtraBodyOpen}
            setIsOpen={setModelExtraBodyOpen}
            addModelKV={addModelKV}
            updateModelKV={updateModelKV}
            removeModelKV={removeModelKV}
          />
          <ModelAdvanced
            modelId={modelId}
            modelConfig={modelConfig}
            isOpen={modelAdvancedOpen}
            setIsOpen={setModelAdvancedOpen}
            updateModelConfig={updateModelConfig}
          />
        </div>
      )}
    </div>
  );
}
