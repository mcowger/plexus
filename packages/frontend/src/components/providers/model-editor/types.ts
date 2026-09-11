export type ModelConfig = Record<string, any>;

export interface ModelTestState {
  loading: boolean;
  result?: 'success' | 'error';
  message?: string;
  showResult: boolean;
  showMessage?: boolean;
}
