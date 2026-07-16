import type { AuthInteraction, OAuthCredentials } from '@earendil-works/pi-ai';
import { OAuthAuthManager } from './oauth-auth-manager';
import {
  getOAuthProviderAuth,
  listOAuthProviders,
  type OAuthProviderDescriptor,
  type OAuthProviderId,
} from './oauth-providers';

export type OAuthSessionStatus =
  | 'in_progress'
  | 'awaiting_auth'
  | 'awaiting_prompt'
  | 'awaiting_manual_code'
  | 'success'
  | 'error'
  | 'cancelled';

export type OAuthAuthInfo = {
  url: string;
  instructions?: string;
};

export type OAuthPrompt = {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

export type OAuthSession = {
  id: string;
  providerId: OAuthProviderId;
  accountId: string;
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

type ProviderResolver = (id: OAuthProviderId) => OAuthProviderDescriptor | undefined;

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

  constructor(providerResolver: ProviderResolver = getOAuthProviderAuth) {
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

  listProviders(): OAuthProviderDescriptor[] {
    return listOAuthProviders();
  }

  getSession(sessionId: string): OAuthSession | undefined {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    return session ? this.stripInternal(session) : undefined;
  }

  async createSession(providerId: OAuthProviderId, accountId: string): Promise<OAuthSession> {
    this.cleanupExpired();
    if (!accountId?.trim()) {
      throw new Error('accountId is required');
    }

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
      accountId,
      status: 'in_progress',
      progress: [],
      createdAt: now,
      updatedAt: now,
      abortController,
      completion: Promise.resolve(),
      expiresAt: now + DEFAULT_SESSION_TTL_MS,
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
      accountId: session.accountId,
      status: session.status,
      authInfo: session.authInfo,
      prompt: session.prompt,
      progress: [...session.progress],
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private touch(session: SessionInternal): void {
    session.updatedAt = Date.now();
  }

  private async runLogin(
    provider: OAuthProviderDescriptor,
    session: SessionInternal
  ): Promise<void> {
    const authManager = OAuthAuthManager.getInstance();

    const awaitUserInput = (manual: boolean, message: string, placeholder?: string) => {
      // Manual-code entry renders as the UI's dedicated redirect-URL input
      // (driven by the awaiting_manual_code status), not the generic prompt
      // input — keep session.prompt unset so only one input is shown.
      //
      // allowEmpty: pi-ai 0.80.9's AuthPrompt dropped the old allowEmpty
      // flag; blank input is passed through and each provider validates it
      // (e.g. Copilot treats a blank GHE domain as github.com), so the UI
      // must not block empty submission.
      session.prompt = manual ? undefined : { message, placeholder, allowEmpty: true };
      session.status = manual ? 'awaiting_manual_code' : 'awaiting_prompt';
      this.touch(session);
      const deferred = createDeferred();
      if (manual) {
        session.resolveManualCode = deferred.resolve;
        session.rejectManualCode = deferred.reject;
      } else {
        session.resolvePrompt = deferred.resolve;
        session.rejectPrompt = deferred.reject;
      }
      return deferred.promise;
    };

    const interaction: AuthInteraction = {
      signal: session.abortController.signal,
      notify: (event) => {
        switch (event.type) {
          case 'auth_url':
            session.authInfo = { url: event.url, instructions: event.instructions };
            session.status = 'awaiting_auth';
            break;
          case 'device_code':
            session.authInfo = {
              url: event.verificationUri,
              instructions: `Enter code: ${event.userCode}`,
            };
            session.status = 'awaiting_auth';
            break;
          case 'progress':
          case 'info':
            session.progress.push(event.message);
            if (session.progress.length > 100) {
              session.progress.shift();
            }
            break;
        }
        this.touch(session);
      },
      prompt: (prompt) => {
        // Select prompts (e.g. Codex login-method chooser) keep the previous
        // behaviour: auto-pick the first option.
        if (prompt.type === 'select') {
          const selected = prompt.options[0]?.id;
          if (selected === undefined) {
            return Promise.reject(new Error('Login cancelled: no options to select'));
          }
          return Promise.resolve(selected);
        }
        return awaitUserInput(prompt.type === 'manual_code', prompt.message, prompt.placeholder);
      },
    };

    try {
      const credentials: OAuthCredentials = await provider.oauth.login(interaction);
      authManager.setCredentials(session.providerId, session.accountId, credentials);
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
