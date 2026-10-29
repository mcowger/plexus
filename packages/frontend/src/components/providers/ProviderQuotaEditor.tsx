import { Provider } from '../../lib/api';
import { AntigravityQuotaConfig } from '../quota/AntigravityQuotaConfig';
import { ApertisQuotaConfig } from '../quota/ApertisQuotaConfig';
import { ClaudeCodeQuotaConfig } from '../quota/ClaudeCodeQuotaConfig';
import { ClineQuotaConfig } from '../quota/ClineQuotaConfig';
import { CrofQuotaConfig } from '../quota/CrofQuotaConfig';
import { CustomQuotaConfig } from '../quota/CustomQuotaConfig';
import { DevPassQuotaConfig } from '../quota/DevPassQuotaConfig';
import { ExeDevQuotaConfig } from '../quota/ExeDevQuotaConfig';
import { GeminiCliQuotaConfig } from '../quota/GeminiCliQuotaConfig';
import { HyperQuotaConfig } from '../quota/HyperQuotaConfig';
import { KiloQuotaConfig } from '../quota/KiloQuotaConfig';
import { KimiCodeQuotaConfig } from '../quota/KimiCodeQuotaConfig';
import { MiniMaxCodingQuotaConfig } from '../quota/MiniMaxCodingQuotaConfig';
import { MiniMaxQuotaConfig } from '../quota/MiniMaxQuotaConfig';
import { MoonshotQuotaConfig } from '../quota/MoonshotQuotaConfig';
import { NagaQuotaConfig } from '../quota/NagaQuotaConfig';
import { NanoGPTQuotaConfig } from '../quota/NanoGPTQuotaConfig';
import { NeuralwattQuotaConfig } from '../quota/NeuralwattQuotaConfig';
import { NovitaQuotaConfig } from '../quota/NovitaQuotaConfig';
import { OllamaQuotaConfig } from '../quota/OllamaQuotaConfig';
import { OpenCodeGoQuotaConfig } from '../quota/OpenCodeGoQuotaConfig';
import { OpenRouterQuotaConfig } from '../quota/OpenRouterQuotaConfig';
import { PoeQuotaConfig } from '../quota/PoeQuotaConfig';
import { RoutingRunQuotaConfig } from '../quota/RoutingRunQuotaConfig';
import { SakanaQuotaConfig } from '../quota/SakanaQuotaConfig';
import { SyntheticQuotaConfig } from '../quota/SyntheticQuotaConfig';
import { WisdomGateQuotaConfig } from '../quota/WisdomGateQuotaConfig';
import { ZAIQuotaConfig } from '../quota/ZAIQuotaConfig';
import { ZenmuxQuotaConfig } from '../quota/ZenmuxQuotaConfig';

interface Props {
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  selectedQuotaCheckerType: string;
  selectableQuotaCheckerTypes: string[];
  isOAuthMode: boolean;
  oauthCheckerType: string | null;
  quotaValidationError: string | null;
  customCheckerIds: string[];
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
  'routing-run': RoutingRunQuotaConfig,
  ollama: OllamaQuotaConfig,
  devpass: DevPassQuotaConfig,
  neuralwatt: NeuralwattQuotaConfig,
  zenmux: ZenmuxQuotaConfig,
  'opencode-go': OpenCodeGoQuotaConfig,
  crof: CrofQuotaConfig,
  exedev: ExeDevQuotaConfig,
  hyper: HyperQuotaConfig,
  sakana: SakanaQuotaConfig,
  cline: ClineQuotaConfig,
  'claude-code': ClaudeCodeQuotaConfig,
};

export function ProviderQuotaEditor({
  editingProvider,
  setEditingProvider,
  selectedQuotaCheckerType,
  selectableQuotaCheckerTypes,
  isOAuthMode,
  oauthCheckerType,
  quotaValidationError,
  customCheckerIds,
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
    <div className="border-border-glass bg-bg-subtle flex flex-col gap-1 rounded-md border p-3">
      <label className="font-body text-text-secondary text-[13px] font-medium">Quota Checker</label>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px] sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="font-body text-text-secondary text-[11px] font-medium">Type</label>
          <select
            className="font-body text-text bg-bg-glass border-border-glass focus:border-primary h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none outline-none"
            value={selectedQuotaCheckerType}
            onChange={(e) => setQuotaType(e.target.value)}
          >
            <option value="">&lt;none&gt;</option>
            {selectableQuotaCheckerTypes.map((type) => (
              <option key={type} value={type}>
                {customCheckerIds.includes(type) ? `Custom: ${type}` : type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-body text-text-secondary text-[11px] font-medium">
            Interval (min)
          </label>
          <input
            className="font-body text-text bg-bg-glass border-border-glass focus:border-primary h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none outline-none"
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
        <div className="border-border-glass bg-bg-subtle mt-3 rounded-md border p-3">
          <QuotaConfigComponent
            options={editingProvider.quotaChecker?.options || {}}
            onChange={setQuotaOptions}
          />
        </div>
      )}
      {customCheckerIds.includes(selectedQuotaCheckerType) && editingProvider.quotaChecker && (
        <div className="border-border-glass bg-bg-subtle mt-3 rounded-md border p-3">
          <CustomQuotaConfig
            checkerId={selectedQuotaCheckerType}
            provider={editingProvider.id}
            options={editingProvider.quotaChecker.options || {}}
            onChange={setQuotaOptions}
          />
        </div>
      )}

      {quotaValidationError && (
        <div className="text-danger bg-danger/10 border-danger/20 mt-2 rounded border px-3 py-2 text-xs">
          {quotaValidationError}
        </div>
      )}
    </div>
  );
}
