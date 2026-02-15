export interface UsageRecord {
    requestId: string;
    date: string; // ISO string
    sourceIp: string | null;
    apiKey: string | null;
    attribution: string | null;
    incomingApiType: string;
    provider: string | null;
    attemptCount: number;
    incomingModelAlias: string | null;
    canonicalModelName: string | null;
    selectedModelName: string | null;
    finalAttemptProvider: string | null;
    finalAttemptModel: string | null;
    allAttemptedProviders: string | null;
    outgoingApiType: string | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    tokensReasoning: number | null;
    tokensCached: number | null;
    tokensCacheWrite?: number | null;
    costInput: number | null;
    costOutput: number | null;
    costCached: number | null;
    costCacheWrite?: number | null;
    costTotal: number | null;
    costSource: string | null;
    costMetadata: string | null;
    startTime: number; // timestamp
    durationMs: number;
    isStreamed: boolean;
    responseStatus: string; // "success", "error", or "HTTP <code"
    ttftMs?: number | null;
    tokensPerSec?: number | null;
    hasDebug?: boolean;
    hasError?: boolean;
    isPassthrough?: boolean;
    tokensEstimated?: number; // 0 = actual usage from provider, 1 = estimated
    createdAt?: number;
    // Request metadata
    toolsDefined?: number | null;
    messageCount?: number | null;
    parallelToolCallsEnabled?: boolean | null;
    // Response metadata
    toolCallsCount?: number | null;
    finishReason?: string | null;
}
