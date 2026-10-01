/**
 * Bounded, TTL'd, API-key-scoped auto-routing state.
 *
 * Holds only routing metadata: the incumbent target, the previous accepted
 * demand/required tier (downgrade hysteresis), cached judgments, per-target
 * warmth observations, and continuation locks. It never stores raw prompts or
 * tool text — judgment cache entries are addressed by caller-supplied
 * fingerprints/keys only.
 *
 * Process-local by design for v1; cold state after restart is acceptable. Keys
 * are always scoped by a server-owned API-key identifier, alias, API contract,
 * and conversation branch, so tenants sharing an alias/branch cannot read each
 * other's state. A request without a conversation branch is scoped by a
 * request-unique coordinate (falling back to a fresh random value) so unrelated
 * conversations never share an incumbent or continuation lock.
 */

import { randomUUID } from 'node:crypto';
import type { AutoCapabilityTier } from '@plexus/shared';
import type { AutoJudgment, AutoWarmthObservation } from './auto-policy';

export interface AutoStateScopeInput {
  /** Server-owned key identifier, never the secret value. */
  keyId: string;
  alias: string;
  apiType: string;
  /** Conversation branch/lineage hint. */
  branch?: string;
  /**
   * Request-unique coordinate supplied by the parent runtime. Only consulted
   * when no branch is available; it keeps the read and write halves of one
   * branchless request in the same scope. When omitted, a fresh random value is
   * used so unrelated branchless requests cannot collide.
   */
  requestUnique?: string;
}

/**
 * Canonical scope key. All state is namespaced under this.
 *
 * Branchless requests must not collapse onto one shared scope: without a
 * branch, unrelated conversations under the same key/alias/contract would
 * otherwise read each other's incumbent, continuation, and warmth. Such
 * requests are namespaced by `requestUnique`, or by a fresh random id when the
 * parent runtime did not supply one.
 */
export function buildAutoStateScope(input: AutoStateScopeInput): string {
  const branch = input.branch ?? `u:${input.requestUnique ?? randomUUID()}`;
  return `${input.keyId}\u0000${input.alias}\u0000${input.apiType.trim().toLowerCase()}\u0000${branch}`;
}

export interface AutoIncumbentState {
  candidateId: string;
  provider: string;
  model: string;
  /** Last accepted composed demand, persisted for downgrade hysteresis. */
  previousDemand: number | null;
  previousRequiredTier: AutoCapabilityTier | number | null;
  observedAt: number;
  sequence: number;
}

export interface AutoJudgmentCacheEntry {
  /** Caller-supplied fingerprint of context + rubric + classifier identity. */
  key: string;
  judgment: AutoJudgment;
  rubricVersion: number;
  classifierId: string;
  createdAt: number;
  expiresAt: number;
}

/** Target identity retained alongside a continuation lock. */
export interface AutoContinuationTarget {
  candidateId: string;
  provider: string;
  model: string;
}

export interface AutoContinuationState {
  locked: boolean;
  updatedAt: number;
  sequence: number;
  /** Present only while a lock is held and a target identity was supplied. */
  candidateId?: string;
  provider?: string;
  model?: string;
}

export interface AutoSessionSnapshot {
  scope: string;
  incumbent: AutoIncumbentState | null;
  judgment: AutoJudgmentCacheEntry | null;
  continuation: AutoContinuationState | null;
  observations: Record<string, AutoWarmthObservation>;
  sequence: number;
}

export interface AutoStateOptions {
  maxSessions?: number;
  sessionTtlMs?: number;
  judgmentTtlMs?: number;
  observationTtlMs?: number;
  /** Upper bound on cached judgments per session; oldest entries are evicted. */
  maxJudgmentsPerSession?: number;
}

const DEFAULT_OPTIONS: Required<AutoStateOptions> = {
  maxSessions: 10_000,
  sessionTtlMs: 30 * 60_000,
  judgmentTtlMs: 5 * 60_000,
  observationTtlMs: 5 * 60_000,
  maxJudgmentsPerSession: 200,
};

/** Judgments are never allowed to grow past this many entries per session. */
const MAX_JUDGMENTS_PER_SESSION = 200;

interface AutoSession {
  scope: string;
  lastAccess: number;
  sequence: number;
  incumbent: AutoIncumbentState | null;
  judgments: Map<string, AutoJudgmentCacheEntry>;
  observations: Map<string, AutoWarmthObservation & { observedAt: number }>;
  continuation: AutoContinuationState | null;
}

export interface RecordIncumbentInput {
  candidateId: string;
  provider: string;
  model: string;
  previousDemand?: number | null;
  previousRequiredTier?: AutoCapabilityTier | number | null;
  sequence?: number;
  now?: number;
}

export interface RecordJudgmentInput {
  key: string;
  judgment: AutoJudgment;
  rubricVersion: number;
  classifierId: string;
  ttlMs?: number;
  sequence?: number;
  now?: number;
}

export interface RecordObservationInput {
  cachedInputTokens: number;
  cacheWriteTokens: number;
  prefixFingerprint?: string;
  ttlMs?: number;
  sequence?: number;
  now?: number;
}

export class AutoStateStore {
  private static instance: AutoStateStore | null = null;

  private readonly options: Required<AutoStateOptions>;
  private sessions: Map<string, AutoSession> = new Map();
  private inFlight: Map<string, Promise<unknown>> = new Map();

  constructor(options: AutoStateOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public static getInstance(): AutoStateStore {
    if (!AutoStateStore.instance) {
      AutoStateStore.instance = new AutoStateStore();
    }
    return AutoStateStore.instance;
  }

  /** Drop the singleton so tests can inject fresh options. */
  public static resetInstanceForTesting(): void {
    AutoStateStore.instance = null;
  }

  private now(explicit?: number): number {
    return explicit ?? Date.now();
  }

  private isExpired(session: AutoSession, now: number): boolean {
    return now - session.lastAccess > this.options.sessionTtlMs;
  }

  /**
   * Move a session to the most-recently-used position. Map iteration order is
   * insertion order, so re-inserting is what makes eviction LRU rather than
   * FIFO.
   */
  private touch(session: AutoSession): void {
    this.sessions.delete(session.scope);
    this.sessions.set(session.scope, session);
  }

  /**
   * Fetch a session only if it is still within TTL. Reads must enforce TTL, not
   * just session creation: otherwise an expired session keeps answering until
   * some unrelated creation happens to sweep it.
   */
  private getLiveSession(scope: string, now: number): AutoSession | null {
    const session = this.sessions.get(scope);
    if (!session) return null;
    if (this.isExpired(session, now)) {
      this.sessions.delete(scope);
      return null;
    }
    return session;
  }

  private getOrCreateSession(scope: string, now: number): AutoSession {
    const existing = this.getLiveSession(scope, now);
    if (existing) {
      existing.lastAccess = now;
      this.touch(existing);
      return existing;
    }
    const session: AutoSession = {
      scope,
      lastAccess: now,
      sequence: 0,
      incumbent: null,
      judgments: new Map(),
      observations: new Map(),
      continuation: null,
    };
    this.sessions.set(scope, session);
    this.enforceBound(now);
    return session;
  }

  /** Evict sessions past TTL and, if still over, the least-recently-used. */
  private enforceBound(now: number): void {
    for (const [scope, session] of this.sessions) {
      if (this.isExpired(session, now)) {
        this.sessions.delete(scope);
      }
    }
    while (this.sessions.size > this.options.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  private pruneObservations(session: AutoSession, now: number): void {
    for (const [candidateId, observation] of session.observations) {
      if (observation.expiresAt !== undefined && now > observation.expiresAt) {
        session.observations.delete(candidateId);
      }
    }
  }

  private pruneJudgments(session: AutoSession, now: number): void {
    for (const [key, entry] of session.judgments) {
      if (now > entry.expiresAt) session.judgments.delete(key);
    }
    const cap = Math.min(this.options.maxJudgmentsPerSession, MAX_JUDGMENTS_PER_SESSION);
    while (session.judgments.size > cap) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, entry] of session.judgments) {
        if (entry.createdAt < oldestAt) {
          oldestAt = entry.createdAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) break;
      session.judgments.delete(oldestKey);
    }
  }

  /**
   * Reserve and return the next request sequence for a scope. Every piece of
   * state written for one request shares this sequence, so a later request's
   * reservation makes an in-flight completion for the earlier request look
   * stale and get rejected.
   */
  reserveSequence(scope: string, now?: number): number {
    const session = this.getOrCreateSession(scope, this.now(now));
    session.sequence += 1;
    return session.sequence;
  }

  recordIncumbent(scope: string, input: RecordIncumbentInput): boolean {
    const now = this.now(input.now);
    const session = this.getOrCreateSession(scope, now);
    // Compare against the session's latest observed request sequence, not just
    // the incumbent's own sequence: a completion arriving after a newer
    // operation (judgment/observation/continuation) must not resurrect an old
    // target.
    if (input.sequence !== undefined && input.sequence < session.sequence) {
      return false;
    }
    // Repeated completions for the same request (early streaming affinity, then
    // final buffered result) must not rewrite the incumbent. Observation
    // updates for the same sequence are still allowed so reported usage can
    // replace the early affinity-only entry.
    if (
      input.sequence !== undefined &&
      session.incumbent !== null &&
      session.incumbent.sequence === input.sequence
    ) {
      return false;
    }
    const sequence = input.sequence ?? session.sequence;
    session.sequence = Math.max(session.sequence, sequence);
    session.incumbent = {
      candidateId: input.candidateId,
      provider: input.provider,
      model: input.model,
      previousDemand: input.previousDemand ?? null,
      previousRequiredTier: input.previousRequiredTier ?? null,
      observedAt: now,
      sequence,
    };
    return true;
  }

  getIncumbent(scope: string, now?: number): AutoIncumbentState | null {
    const current = this.now(now);
    const session = this.getLiveSession(scope, current);
    if (!session) return null;
    session.lastAccess = current;
    this.touch(session);
    return session.incumbent ? { ...session.incumbent } : null;
  }

  recordJudgment(scope: string, input: RecordJudgmentInput): void {
    const now = this.now(input.now);
    const session = this.getOrCreateSession(scope, now);
    if (input.sequence !== undefined && input.sequence < session.sequence) {
      return;
    }
    if (input.sequence !== undefined) session.sequence = Math.max(session.sequence, input.sequence);
    session.judgments.set(input.key, {
      key: input.key,
      judgment: input.judgment,
      rubricVersion: input.rubricVersion,
      classifierId: input.classifierId,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? this.options.judgmentTtlMs),
    });
    this.pruneJudgments(session, now);
  }

  getJudgment(scope: string, key: string, now?: number): AutoJudgmentCacheEntry | null {
    const current = this.now(now);
    const session = this.getLiveSession(scope, current);
    if (!session) return null;
    session.lastAccess = current;
    this.touch(session);
    this.pruneJudgments(session, current);
    const entry = session.judgments.get(key);
    return entry ? { ...entry } : null;
  }

  recordObservation(scope: string, candidateId: string, input: RecordObservationInput): boolean {
    const now = this.now(input.now);
    const session = this.getOrCreateSession(scope, now);
    // Late completions must not overwrite newer evidence, even for a different
    // target: a stale observation may not regress state after a newer request.
    if (input.sequence !== undefined && input.sequence < session.sequence) {
      return false;
    }
    const existing = session.observations.get(candidateId);
    if (
      existing &&
      input.sequence !== undefined &&
      existing.sequence !== undefined &&
      input.sequence < existing.sequence
    ) {
      return false;
    }
    if (input.sequence !== undefined) session.sequence = Math.max(session.sequence, input.sequence);
    const expiresAt = now + (input.ttlMs ?? this.options.observationTtlMs);
    session.observations.set(candidateId, {
      cachedInputTokens: input.cachedInputTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      prefixFingerprint: input.prefixFingerprint,
      expiresAt,
      sequence: input.sequence,
      observedAt: now,
    });
    return true;
  }

  /**
   * Warmth observation for a target, or null when none/expired. A caller that
   * knows the current prefix passes it; a mismatch returns null (changed prefix
   * means the old evidence is not valid warmth). Callers that don't know the
   * current prefix still receive the observation so the policy can mark warmth
   * uncertain rather than silently treating it as a hit.
   */
  getWarmth(
    scope: string,
    candidateId: string,
    prefixFingerprint?: string,
    now?: number
  ): AutoWarmthObservation | null {
    const current = this.now(now);
    const session = this.getLiveSession(scope, current);
    if (!session) return null;
    session.lastAccess = current;
    this.touch(session);
    this.pruneObservations(session, current);
    const observation = session.observations.get(candidateId);
    if (!observation) return null;
    if (
      prefixFingerprint !== undefined &&
      observation.prefixFingerprint !== undefined &&
      observation.prefixFingerprint !== prefixFingerprint
    ) {
      return null;
    }
    return {
      cachedInputTokens: observation.cachedInputTokens,
      cacheWriteTokens: observation.cacheWriteTokens,
      prefixFingerprint: observation.prefixFingerprint,
      expiresAt: observation.expiresAt,
      sequence: observation.sequence,
    };
  }

  /**
   * Persist a continuation lock. `target` retains the locked provider/model so
   * a later request can tell which target the lock applies to; it is stored
   * only while locked and cleared when the lock is released.
   */
  setContinuation(
    scope: string,
    locked: boolean,
    sequence?: number,
    now?: number,
    target?: AutoContinuationTarget
  ): void {
    const current = this.now(now);
    const session = this.getOrCreateSession(scope, current);
    if (sequence !== undefined && sequence < session.sequence) {
      return;
    }
    const nextSequence = sequence ?? session.sequence;
    session.sequence = Math.max(session.sequence, nextSequence);
    const previous = session.continuation;
    session.continuation = {
      locked,
      updatedAt: current,
      sequence: nextSequence,
      ...(locked
        ? {
            candidateId: target?.candidateId ?? previous?.candidateId,
            provider: target?.provider ?? previous?.provider,
            model: target?.model ?? previous?.model,
          }
        : {}),
    };
  }

  getContinuation(scope: string, now?: number): AutoContinuationState | null {
    const current = this.now(now);
    const session = this.getLiveSession(scope, current);
    if (!session) return null;
    session.lastAccess = current;
    this.touch(session);
    return session.continuation ? { ...session.continuation } : null;
  }

  snapshot(scope: string, now?: number): AutoSessionSnapshot | null {
    const current = this.now(now);
    const session = this.getLiveSession(scope, current);
    if (!session) return null;
    session.lastAccess = current;
    this.touch(session);
    this.pruneJudgments(session, current);
    this.pruneObservations(session, current);
    const observations: Record<string, AutoWarmthObservation> = {};
    for (const [candidateId, observation] of session.observations) {
      observations[candidateId] = {
        cachedInputTokens: observation.cachedInputTokens,
        cacheWriteTokens: observation.cacheWriteTokens,
        prefixFingerprint: observation.prefixFingerprint,
        expiresAt: observation.expiresAt,
        sequence: observation.sequence,
      };
    }
    let latestJudgment: AutoJudgmentCacheEntry | null = null;
    for (const entry of session.judgments.values()) {
      if (!latestJudgment || entry.createdAt >= latestJudgment.createdAt) {
        latestJudgment = { ...entry };
      }
    }
    return {
      scope: session.scope,
      incumbent: session.incumbent ? { ...session.incumbent } : null,
      judgment: latestJudgment,
      continuation: session.continuation ? { ...session.continuation } : null,
      observations,
      sequence: session.sequence,
    };
  }

  /** Clear one scope. */
  reset(scope: string): void {
    this.sessions.delete(scope);
  }

  /** Clear all state and in-flight work. Test helper. */
  resetForTesting(): void {
    this.sessions.clear();
    this.inFlight.clear();
  }

  size(): number {
    return this.sessions.size;
  }

  /**
   * Deduplicate concurrent classifier work within an explicit scope. The
   * key is namespaced by `scope` so tenants sharing a classifier key cannot
   * share in-flight work. The returned promise is shared by every concurrent
   * caller and the entry clears when it settles.
   *
   * An optional `signal` detaches only the calling waiter on abort; the shared
   * operation keeps running for the remaining waiters. Callers must not pass a
   * signal into `fn` if they expect one waiter's cancellation to be isolated.
   */
  singleFlight<T>(
    scope: string,
    key: string,
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const flightKey = `${scope}\u0000${key}`;
    let shared = this.inFlight.get(flightKey) as Promise<T> | undefined;
    if (!shared) {
      shared = fn().finally(() => {
        this.inFlight.delete(flightKey);
      });
      this.inFlight.set(flightKey, shared);
    }
    if (!signal) return shared;
    if (signal.aborted) return Promise.reject(singleFlightAbortError());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(singleFlightAbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      shared!.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }
}

function singleFlightAbortError(): Error {
  const error = new Error('single-flight aborted');
  error.name = 'AbortError';
  return error;
}
