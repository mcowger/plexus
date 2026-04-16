import type { QuotaCheckerConfig, QuotaChecker } from '../../types/quota';
import { SyntheticQuotaChecker } from './checkers/synthetic-checker';
import { ClaudeCodeQuotaChecker } from './checkers/claude-code-checker';
import { NagaQuotaChecker } from './checkers/naga-checker';
import { OpenAICodexQuotaChecker } from './checkers/openai-codex-checker';
import { NanoGPTQuotaChecker } from './checkers/nanogpt-checker';
import { ZAIQuotaChecker } from './checkers/zai-checker';
import { MoonshotQuotaChecker } from './checkers/moonshot-checker';
import { NovitaQuotaChecker } from './checkers/novita-checker';
import { MiniMaxQuotaChecker } from './checkers/minimax-checker';
import { MiniMaxCodingQuotaChecker } from './checkers/minimax-coding-checker';
import { OpenRouterQuotaChecker } from './checkers/openrouter-checker';
import { KiloQuotaChecker } from './checkers/kilo-checker';
import { KimiCodeQuotaChecker } from './checkers/kimi-code-checker';
import { CopilotQuotaChecker } from './checkers/copilot-checker';
import { WisdomGateQuotaChecker } from './checkers/wisdomgate-checker';
import { ApertisQuotaChecker } from './checkers/apertis-checker';
import { ApertisCodingPlanQuotaChecker } from './checkers/apertis-coding-plan-checker';
import { PoeQuotaChecker } from './checkers/poe-checker';
import { GeminiCliQuotaChecker } from './checkers/gemini-cli-checker';
import { AntigravityQuotaChecker } from './checkers/antigravity-checker';
import { OllamaQuotaChecker } from './checkers/ollama-checker';
import { NeuralwattQuotaChecker } from './checkers/neuralwatt-checker';

const CHECKER_REGISTRY: Record<string, new (config: QuotaCheckerConfig) => QuotaChecker> = {
  synthetic: SyntheticQuotaChecker,
  'claude-code': ClaudeCodeQuotaChecker,
  naga: NagaQuotaChecker,
  'openai-codex': OpenAICodexQuotaChecker,
  nanogpt: NanoGPTQuotaChecker,
  zai: ZAIQuotaChecker,
  moonshot: MoonshotQuotaChecker,
  novita: NovitaQuotaChecker,
  minimax: MiniMaxQuotaChecker,
  'minimax-coding': MiniMaxCodingQuotaChecker,
  openrouter: OpenRouterQuotaChecker,
  kilo: KiloQuotaChecker,
  'kimi-code': KimiCodeQuotaChecker,
  copilot: CopilotQuotaChecker,
  wisdomgate: WisdomGateQuotaChecker,
  apertis: ApertisQuotaChecker,
  'apertis-coding-plan': ApertisCodingPlanQuotaChecker,
  poe: PoeQuotaChecker,
  'gemini-cli': GeminiCliQuotaChecker,
  antigravity: AntigravityQuotaChecker,
  ollama: OllamaQuotaChecker,
  neuralwatt: NeuralwattQuotaChecker,
};

export class QuotaCheckerFactory {
  static registerChecker(
    type: string,
    checkerClass: new (config: QuotaCheckerConfig) => QuotaChecker
  ): void {
    CHECKER_REGISTRY[type.toLowerCase()] = checkerClass;
  }

  static createChecker(type: string, config: QuotaCheckerConfig): QuotaChecker {
    const normalizedType = type.toLowerCase();
    const CheckerClass = CHECKER_REGISTRY[normalizedType];

    if (!CheckerClass) {
      throw new Error(
        `Unknown quota checker type: '${type}'. Available types: ${Object.keys(CHECKER_REGISTRY).join(', ')}`
      );
    }

    return new CheckerClass(config);
  }

  static isRegistered(type: string): boolean {
    return type.toLowerCase() in CHECKER_REGISTRY;
  }

  static getRegisteredTypes(): string[] {
    return Object.keys(CHECKER_REGISTRY);
  }
}
