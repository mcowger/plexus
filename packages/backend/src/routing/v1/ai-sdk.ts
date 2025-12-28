import { Hono } from "hono";
import { generateText, LanguageModel, CallSettings } from "ai";
import superjson from "superjson";
import { selectProvider } from "../selector.js";
import { ProviderFactory } from "../../providers/factory.js";
import { logger } from "../../utils/logger.js";
import { LanguageModelV2Prompt } from "@ai-sdk/provider";
import { ConvertedRequest } from "../../conversion/index.js";

// Type for the generateText request (model + CallSettings + Prompt)
type GenerateTextRequest = CallSettings & {
  model: string | LanguageModel;
  prompt: LanguageModelV2Prompt;
};

// Type guard to check if deserialized request is valid
// We validate that it has the required fields
function isValidGenerateTextRequest(obj: unknown): obj is GenerateTextRequest {
  // Check that obj is an object before casting
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const req = obj as Partial<GenerateTextRequest>;

  // Must have model (string or LanguageModel object with modelId)
  if (!req.model) {
    return false;
  }

  if (typeof req.model !== 'string' && 
      (typeof req.model !== 'object' || !('modelId' in req.model))) {
    return false;
  }

  // Must have prompt (can be string or array)
  if (!req.prompt) {
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
    const convertedRequest: ConvertedRequest = {
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

    // Serialize the result with superjson and return as a string
    const serializedResult = superjson.stringify(result);

    // Return the serialized string directly without double encoding
    return new Response(serializedResult, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
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
