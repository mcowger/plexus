export interface UsageRecord {
    requestId: string;
    date: string; // ISO string
    sourceIp: string | null;
    apiKey: string | null;
    attribution: string | null;
    incomingApiType: string;
    provider: string | null;
    incomingModelAlias: string | null;
    canonicalModelName: string | null;
    selectedModelName: string | null;
    outgoingApiType: string | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    tokensReasoning: number | null;
    tokensCached: number | null;
    costInput: number | null;
    costOutput: number | null;
    costCached: number | null;
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
}
