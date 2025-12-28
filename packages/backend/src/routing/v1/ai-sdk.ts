import { Hono } from "hono";
import { generateText, LanguageModel } from "ai";
import superjson from "superjson";
import { selectProvider } from "../selector.js";
import { ProviderFactory } from "../../providers/factory.js";
import { logger } from "../../utils/logger.js";
import { LanguageModelV2Prompt } from "@ai-sdk/provider";

// Interface for the deserialized AI SDK generateText request
// This should match the parameters accepted by generateText()
interface GenerateTextRequest {
  model: string | LanguageModel;
  prompt: LanguageModelV2Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  headers?: Record<string, string | undefined>;
  tools?: Record<string, any>;
  toolChoice?: any;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  experimental_telemetry?: any;
}

// Type guard to check if deserialized request is valid
function isValidGenerateTextRequest(obj: unknown): obj is GenerateTextRequest {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const req = obj as any;

  // Must have model (string or LanguageModel object with modelId)
  if (!('model' in req)) {
    return false;
  }

  if (typeof req.model !== 'string' && 
      (typeof req.model !== 'object' || req.model === null || !('modelId' in req.model))) {
    return false;
  }

  // Must have prompt (can be string or array)
  if (!('prompt' in req)) {
    return false;
  }

  // Prompt can be a string or an array
  if (typeof req.prompt !== 'string' && !Array.isArray(req.prompt)) {
    return false;
  }

  return true;
}

// AI SDK route handler
export async function handleAiSdkEndpoint(c: any) {
  try {
    // Parse the request body as JSON
    const body = await c.req.json();

    logger.info("Received AI SDK request");

    // Deserialize the request using superjson
    const deserializedRequest = superjson.deserialize(body);

    logger.debug("Deserialized request:", deserializedRequest);

    // Validate the deserialized request
    if (!isValidGenerateTextRequest(deserializedRequest)) {
      throw new Error("Invalid request format: must contain model and prompt");
    }

    // Extract model identifier from the request
    let modelIdentifier: string;
    if (typeof deserializedRequest.model === 'string') {
      modelIdentifier = deserializedRequest.model;
    } else {
      modelIdentifier = deserializedRequest.model.modelId;
    }

    // Create a ConvertedRequest for provider selection with the prompt from the request
    const convertedRequest = {
      model: modelIdentifier,
      options: {
        prompt: deserializedRequest.prompt,
      },
    };

    // Select appropriate provider for the model and get canonical slug
    const { provider: providerConfig, canonicalModelSlug } = selectProvider(convertedRequest);

    // Create provider client
    const providerClient = ProviderFactory.createClient(providerConfig);

    // Get the appropriate model from the provider instance using the canonical slug
    const model: LanguageModel = providerClient.getModel(canonicalModelSlug);

    // Replace the model in the request with the selected provider's model
    deserializedRequest.model = model;

    // Call generateText with the modified request
    logger.info("Calling generateText on provider client");

    const result = await generateText(deserializedRequest);

    logger.info("Successfully generated text response");

    // Serialize the result with superjson
    const serializedResult = superjson.serialize(result);

    // Return the serialized result as JSON (superjson.serialize returns {json, meta})
    // We return the whole serialized object, not double-encoded
    // Using consistent c.json() format for success response
    return c.json(serializedResult);
  } catch (error) {
    logger.error("AI SDK endpoint error:", error);

    let errorMessage = "Failed to process AI SDK request";
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return c.json(
      {
        error: errorMessage,
      },
      500
    );
  }
}

// Register AI SDK routes
export function registerV1AiSdkRoutes(app: Hono) {
  // AI SDK endpoint - requires authentication (handled in index.ts)
  app.post("/v1/ai-sdk", handleAiSdkEndpoint);
}
