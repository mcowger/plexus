export const CHECKER_DISPLAY_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  minimax: 'MiniMax',
  'minimax-coding': 'MiniMax Coding',
  moonshot: 'Moonshot',
  naga: 'Naga',
  novita: 'Novita',
  kilo: 'Kilo',
  poe: 'POE',
  'openai-codex': 'OpenAI Codex',
  'claude-code': 'Claude Code',
  zai: 'ZAI',
  synthetic: 'Synthetic',
  nanogpt: 'NanoGPT',
  'kimi-code': 'Kimi Code',
  copilot: 'GitHub Copilot',
  wisdomgate: 'Wisdom Gate',
  'gemini-cli': 'Gemini CLI',
  antigravity: 'Antigravity',
  apertis: 'Apertis',
  ollama: 'Ollama',
  neuralwatt: 'Neuralwatt',
  zenmux: 'Zenmux',
};

export function getCheckerDisplayName(checkerType: string | undefined, checkerId: string): string {
  if (checkerType && CHECKER_DISPLAY_NAMES[checkerType]) return CHECKER_DISPLAY_NAMES[checkerType];
  return checkerId;
}
