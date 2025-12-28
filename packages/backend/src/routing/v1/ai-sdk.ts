import { Hono } from "hono";
import { generateText, LanguageModel } from "ai";
import superjson from "superjson";
import { selectProvider } from "../selector.js";
import { ProviderFactory } from "../../providers/factory.js";
import { logger } from "../../utils/logger.js";

// Interface for the deserialized AI SDK request
interface AiSdkRequest {
  model: string | { modelId: string; [key: string]: any };
  prompt?: any[];
  [key: string]: any;
}

// Type guard to check if deserialized request is valid
function isValidAiSdkRequest(obj: unknown): obj is AiSdkRequest {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'model' in obj &&
    (typeof obj.model === 'string' || (typeof obj.model === 'object' && obj.model !== null && 'modelId' in obj.model))
  );
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
    if (!isValidAiSdkRequest(deserializedRequest)) {
      throw new Error("Invalid request format");
    }

    // Extract model identifier from the request
    let modelIdentifier: string;
    if (typeof deserializedRequest.model === 'string') {
      modelIdentifier = deserializedRequest.model;
    } else {
      modelIdentifier = deserializedRequest.model.modelId;
    }

    // Create a minimal ConvertedRequest for provider selection
    const convertedRequest = {
      model: modelIdentifier,
      options: {
        prompt: deserializedRequest.prompt || [],
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
