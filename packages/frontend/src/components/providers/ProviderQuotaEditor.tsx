import { Provider } from '../../lib/api';
import { NagaQuotaConfig } from '../quota/NagaQuotaConfig';
import { SyntheticQuotaConfig } from '../quota/SyntheticQuotaConfig';
import { NanoGPTQuotaConfig } from '../quota/NanoGPTQuotaConfig';
import { ZAIQuotaConfig } from '../quota/ZAIQuotaConfig';
import { MoonshotQuotaConfig } from '../quota/MoonshotQuotaConfig';
import { NovitaQuotaConfig } from '../quota/NovitaQuotaConfig';
import { MiniMaxQuotaConfig } from '../quota/MiniMaxQuotaConfig';
import { MiniMaxCodingQuotaConfig } from '../quota/MiniMaxCodingQuotaConfig';
import { OpenRouterQuotaConfig } from '../quota/OpenRouterQuotaConfig';
import { KiloQuotaConfig } from '../quota/KiloQuotaConfig';
import { WisdomGateQuotaConfig } from '../quota/WisdomGateQuotaConfig';
import { GeminiCliQuotaConfig } from '../quota/GeminiCliQuotaConfig';
import { AntigravityQuotaConfig } from '../quota/AntigravityQuotaConfig';
import { ApertisQuotaConfig } from '../quota/ApertisQuotaConfig';
import { KimiCodeQuotaConfig } from '../quota/KimiCodeQuotaConfig';
import { PoeQuotaConfig } from '../quota/PoeQuotaConfig';
import { OllamaQuotaConfig } from '../quota/OllamaQuotaConfig';
import { DevPassQuotaConfig } from '../quota/DevPassQuotaConfig';
import { NeuralwattQuotaConfig } from '../quota/NeuralwattQuotaConfig';
import { ZenmuxQuotaConfig } from '../quota/ZenmuxQuotaConfig';
import { WaferQuotaConfig } from '../quota/WaferQuotaConfig';

interface Props {
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  selectedQuotaCheckerType: string;
  selectableQuotaCheckerTypes: string[];
  isOAuthMode: boolean;
  oauthCheckerType: string | null;
  quotaValidationError: string | null;
}

const QUOTA_CONFIG_MAP: Record<
  string,
  React.ComponentType<{
    options: Record<string, unknown>;
    onChange: (options: Record<string, unknown>) => void;
  }>
> = {
  naga: NagaQuotaConfig,
  synthetic: SyntheticQuotaConfig,
  nanogpt: NanoGPTQuotaConfig,
  zai: ZAIQuotaConfig,
  moonshot: MoonshotQuotaConfig,
  novita: NovitaQuotaConfig,
  minimax: MiniMaxQuotaConfig,
  'minimax-coding': MiniMaxCodingQuotaConfig,
  openrouter: OpenRouterQuotaConfig,
  kilo: KiloQuotaConfig,
  wisdomgate: WisdomGateQuotaConfig,
  'gemini-cli': GeminiCliQuotaConfig,
  antigravity: AntigravityQuotaConfig,
  apertis: ApertisQuotaConfig,
  'kimi-code': KimiCodeQuotaConfig,
  poe: PoeQuotaConfig,
  ollama: OllamaQuotaConfig,
  devpass: DevPassQuotaConfig,
  neuralwatt: NeuralwattQuotaConfig,
  zenmux: ZenmuxQuotaConfig,
  wafer: WaferQuotaConfig,
};

export function ProviderQuotaEditor({
  editingProvider,
  setEditingProvider,
  selectedQuotaCheckerType,
  selectableQuotaCheckerTypes,
  isOAuthMode,
  oauthCheckerType,
  quotaValidationError,
}: Props) {
  const setQuotaType = (quotaType: string) => {
    if (!quotaType) {
      setEditingProvider({ ...editingProvider, quotaChecker: undefined });
      return;
    }
    setEditingProvider({
      ...editingProvider,
      quotaChecker: {
        type: quotaType,
        enabled: true,
        intervalMinutes: Math.max(1, editingProvider.quotaChecker?.intervalMinutes || 30),
        options: editingProvider.quotaChecker?.options,
      },
    });
  };

  const setQuotaInterval = (intervalMinutes: number) => {
    setEditingProvider({
      ...editingProvider,
      quotaChecker: {
        ...editingProvider.quotaChecker,
        type: selectedQuotaCheckerType,
        enabled: selectedQuotaCheckerType ? editingProvider.quotaChecker?.enabled !== false : false,
        intervalMinutes,
      },
    });
  };

  const setQuotaOptions = (options: Record<string, unknown>) => {
    setEditingProvider({
      ...editingProvider,
      quotaChecker: { ...editingProvider.quotaChecker, options } as Provider['quotaChecker'],
    });
  };

  const QuotaConfigComponent = selectedQuotaCheckerType
    ? QUOTA_CONFIG_MAP[selectedQuotaCheckerType]
    : null;

  return (
    <div className="flex flex-col gap-1 border border-border-glass rounded-md p-3 bg-bg-subtle">
      <label className="font-body text-[13px] font-medium text-text-secondary">Quota Checker</label>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px] sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="font-body text-[11px] font-medium text-text-secondary">Type</label>
          <select
            className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
            value={selectedQuotaCheckerType}
            onChange={(e) => setQuotaType(e.target.value)}
          >
            <option value="">&lt;none&gt;</option>
            {selectableQuotaCheckerTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-body text-[11px] font-medium text-text-secondary">
            Interval (min)
          </label>
          <input
            className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
            type="number"
            min={1}
            step={1}
            value={editingProvider.quotaChecker?.intervalMinutes || 30}
            disabled={!selectedQuotaCheckerType}
            onChange={(e) => setQuotaInterval(Math.max(1, parseInt(e.target.value, 10) || 30))}
          />
        </div>
      </div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--color-text-secondary)',
          marginTop: '4px',
          fontStyle: 'italic',
        }}
      >
        {isOAuthMode && oauthCheckerType
          ? `Only the '${oauthCheckerType}' checker is available for this OAuth provider.`
          : isOAuthMode
            ? 'No quota checker is available for this OAuth provider type.'
            : selectedQuotaCheckerType
              ? 'Quota checker is active for this provider.'
              : 'Select <none> to disable provider quota checks.'}
      </div>

      {QuotaConfigComponent && (
        <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
          <QuotaConfigComponent
            options={editingProvider.quotaChecker?.options || {}}
            onChange={setQuotaOptions}
          />
        </div>
      )}

      {quotaValidationError && (
        <div className="mt-2 text-xs text-danger bg-danger/10 border border-danger/20 rounded px-3 py-2">
          {quotaValidationError}
        </div>
      )}
    </div>
  );
}
