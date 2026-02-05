import { getOAuthProvider, getOAuthProviders } from '@mariozechner/pi-ai';
import type { OAuthAuthInfo, OAuthCredentials, OAuthLoginCallbacks, OAuthPrompt, OAuthProviderId, OAuthProviderInterface } from '@mariozechner/pi-ai';
import { OAuthAuthManager } from './oauth-auth-manager';

export type OAuthSessionStatus =
  | 'in_progress'
  | 'awaiting_auth'
  | 'awaiting_prompt'
  | 'awaiting_manual_code'
  | 'success'
  | 'error'
  | 'cancelled';

export type OAuthSession = {
  id: string;
  providerId: OAuthProviderId;
  status: OAuthSessionStatus;
  authInfo?: OAuthAuthInfo;
  prompt?: OAuthPrompt;
  progress: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
};

type SessionInternal = OAuthSession & {
  resolvePrompt?: (value: string) => void;
  rejectPrompt?: (error: Error) => void;
  resolveManualCode?: (value: string) => void;
  rejectManualCode?: (error: Error) => void;
  abortController: AbortController;
  completion: Promise<void>;
  expiresAt: number;
};

type ProviderResolver = (id: OAuthProviderId) => OAuthProviderInterface | undefined;

const DEFAULT_SESSION_TTL_MS = 20 * 60 * 1000;

const createSessionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createDeferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export class OAuthLoginSessionManager {
  private sessions = new Map<string, SessionInternal>();
  private providerResolver: ProviderResolver;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(providerResolver: ProviderResolver = getOAuthProvider) {
    this.providerResolver = providerResolver;
    this.startCleanup();
  }

  static instance: OAuthLoginSessionManager | undefined;

  static getInstance(): OAuthLoginSessionManager {
    if (!this.instance) {
      this.instance = new OAuthLoginSessionManager();
    }
    return this.instance;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  listProviders(): OAuthProviderInterface[] {
    return getOAuthProviders();
  }

  getSession(sessionId: string): OAuthSession | undefined {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    return session ? this.stripInternal(session) : undefined;
  }

  async createSession(providerId: OAuthProviderId): Promise<OAuthSession> {
    this.cleanupExpired();
    const provider = this.providerResolver(providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth provider: ${providerId}`);
    }

    const now = Date.now();
    const sessionId = createSessionId();
    const abortController = new AbortController();

    const session: SessionInternal = {
      id: sessionId,
      providerId,
      status: 'in_progress',
      progress: [],
      createdAt: now,
      updatedAt: now,
      abortController,
      completion: Promise.resolve(),
      expiresAt: now + DEFAULT_SESSION_TTL_MS
    };

    session.completion = this.runLogin(provider, session).catch(() => undefined);
    this.sessions.set(sessionId, session);
    return this.stripInternal(session);
  }

  async submitPrompt(sessionId: string, value: string): Promise<OAuthSession> {
    const session = this.getInternal(sessionId);
    if (!session.resolvePrompt) {
      throw new Error('No prompt is awaiting input');
    }
    session.resolvePrompt(value);
    session.resolvePrompt = undefined;
    session.rejectPrompt = undefined;
    session.prompt = undefined;
    if (session.status === 'awaiting_prompt') {
      session.status = 'in_progress';
    }
    this.touch(session);
    return this.stripInternal(session);
  }

  async submitManualCode(sessionId: string, value: string): Promise<OAuthSession> {
    const session = this.getInternal(sessionId);
    if (!session.resolveManualCode) {
      throw new Error('No manual code input is awaiting input');
    }
    session.resolveManualCode(value);
    session.resolveManualCode = undefined;
    session.rejectManualCode = undefined;
    if (session.status === 'awaiting_manual_code') {
      session.status = 'in_progress';
    }
    this.touch(session);
    return this.stripInternal(session);
  }

  async cancel(sessionId: string): Promise<OAuthSession> {
    const session = this.getInternal(sessionId);
    if (session.status === 'success' || session.status === 'error') {
      return this.stripInternal(session);
    }
    session.status = 'cancelled';
    session.error = 'Login cancelled';
    session.abortController.abort();
    session.rejectPrompt?.(new Error('Login cancelled'));
    session.rejectManualCode?.(new Error('Login cancelled'));
    session.resolvePrompt = undefined;
    session.rejectPrompt = undefined;
    session.resolveManualCode = undefined;
    session.rejectManualCode = undefined;
    this.touch(session);
    return this.stripInternal(session);
  }

  private getInternal(sessionId: string): SessionInternal {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('OAuth session not found');
    }
    return session;
  }

  private stripInternal(session: SessionInternal): OAuthSession {
    return {
      id: session.id,
      providerId: session.providerId,
      status: session.status,
      authInfo: session.authInfo,
      prompt: session.prompt,
      progress: [...session.progress],
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  }

  private touch(session: SessionInternal): void {
    session.updatedAt = Date.now();
  }

  private async runLogin(provider: OAuthProviderInterface, session: SessionInternal): Promise<void> {
    const authManager = OAuthAuthManager.getInstance();

    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        session.authInfo = info;
        session.status = 'awaiting_auth';
        this.touch(session);
      },
      onPrompt: async (prompt) => {
        session.prompt = prompt;
        session.status = 'awaiting_prompt';
        this.touch(session);
        const deferred = createDeferred();
        session.resolvePrompt = deferred.resolve;
        session.rejectPrompt = deferred.reject;
        return deferred.promise;
      },
      onProgress: (message) => {
        session.progress.push(message);
        if (session.progress.length > 100) {
          session.progress.shift();
        }
        this.touch(session);
      },
      onManualCodeInput: async () => {
        session.status = 'awaiting_manual_code';
        this.touch(session);
        const deferred = createDeferred();
        session.resolveManualCode = deferred.resolve;
        session.rejectManualCode = deferred.reject;
        return deferred.promise;
      },
      signal: session.abortController.signal
    };

    try {
      const credentials: OAuthCredentials = await provider.login(callbacks);
      authManager.setCredentials(provider.id, credentials);
      session.status = 'success';
      session.error = undefined;
      session.prompt = undefined;
      session.resolvePrompt = undefined;
      session.rejectPrompt = undefined;
      session.resolveManualCode = undefined;
      session.rejectManualCode = undefined;
      this.touch(session);
    } catch (error) {
      if (session.status !== 'cancelled') {
        session.status = 'error';
        session.error = error instanceof Error ? error.message : String(error);
        this.touch(session);
      }
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60 * 1000);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        session.abortController.abort();
        this.sessions.delete(id);
      }
    }
  }
}
