import type { ApiType } from "../services/transformer-factory";
/**
 * Debug trace entry for detailed request/response capture
 */

type responseFormatSource = "original" | "reconstructed";

export interface DebugTraceEntry {
  id: string; // Request ID
  timestamp: string;

  // Request details
  clientRequest: {
    apiType: ApiType;
    body: any;
    headers: Record<string, string>;
  };

  // Transformation steps
   providerRequest: {
    apiType: ApiType;
    body: any;
    headers: Record<string, string>;
  };

  // Provider response
  providerResponse?: {
    status: number;
    headers: Record<string, string>;
    body: any;
    type?: responseFormatSource
  };

  // Transformed response
  clientResponse?: {
    status: number;
    body: any;
    type?: responseFormatSource
  };

  // Stream chunks (for streaming requests)
  providerStreamChunks?: Array<{
    timestamp: string;
    chunk: any;
  }>;
    // Stream chunks sent to client (for streaming requests)
  clientStreamChunks?: Array<{
    timestamp: string;
    chunk: any;
  }>;
}
