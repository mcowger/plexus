export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected';

export type A2AMessageRole = 'user' | 'agent' | 'system';

export interface A2ATextPart {
  type: 'text';
  text: string;
  metadata?: Record<string, unknown>;
}

export interface A2AFilePart {
  type: 'file';
  file: {
    name?: string;
    mimeType?: string;
    uri?: string;
    bytesBase64?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface A2ADataPart {
  type: 'data';
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2AMessage {
  role: A2AMessageRole;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export interface A2AArtifact {
  artifactId?: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatus {
  state: A2ATaskState;
  timestamp: string;
  message?: A2AMessage;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

export interface A2AAgentInterface {
  protocol: string;
  transport?: string;
  url: string;
}

export interface A2AAgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  extensions?: string[];
}

export interface A2AAgentCard {
  name: string;
  description?: string;
  version: string;
  url: string;
  capabilities: A2AAgentCapabilities;
  skills: A2AAgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  additionalInterfaces?: A2AAgentInterface[];
  metadata?: Record<string, unknown>;
}

export interface A2AErrorEnvelope {
  error: {
    code:
      | 'INVALID_REQUEST'
      | 'UNAUTHENTICATED'
      | 'FORBIDDEN'
      | 'TASK_NOT_FOUND'
      | 'INVALID_TASK_STATE'
      | 'CAPABILITY_NOT_SUPPORTED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'RATE_LIMITED'
      | 'INTERNAL_ERROR';
    message: string;
    details?: Record<string, unknown>;
  };
}
