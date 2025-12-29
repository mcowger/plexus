import { Hono } from "hono";
import { generateText, LanguageModel } from "ai";
import { convertFromAnthropicMessagesRequest } from "../../../conversion/anthropic/request.js";
import { convertToAnthropicMessagesResponse } from "../../../conversion/anthropic/response.js";
import { selectProvider } from "../../../routing/selector.js";
import { ProviderFactory } from "../../../providers/factory.js";
import { logger } from "../../../utils/logger.js";
import { createGenerateTextRequest } from "../../utils.js";

// Anthropic Messages API route handler
export async function handleAnthropicMessagesEndpoint(c: any) {
  try {
    // Parse the request body as JSON
    const body = await c.req.json();

    logger.info("Received Anthropic Messages API request");

    // Convert from Anthropic Messages API format to LanguageModelV2 format
    const convertedRequest = convertFromAnthropicMessagesRequest(body);

    // Log warnings if any
    if (convertedRequest.warnings && convertedRequest.warnings.length > 0) {
      convertedRequest.warnings.forEach((warning) => {
        logger.warn(`Request conversion warning: ${warning.type} - ${warning.message}`);
      });
    }

    // Select appropriate provider for the model and get canonical slug
    const { provider: providerConfig, canonicalModelSlug } = selectProvider(convertedRequest);

    // Create provider client
    const providerClient = ProviderFactory.createClient(providerConfig);

    // Get the appropriate model from the provider instance using the canonical slug
    const model: LanguageModel = providerClient.getModel(
      canonicalModelSlug
    );

    const generateTextRequest = createGenerateTextRequest(convertedRequest, model);

    // Call generateText with the model and converted request
    logger.info("Calling generateText on provider client");

    const result = await generateText(generateTextRequest);

    logger.info("Successfully generated text response");

    // Convert the result to Anthropic Messages API response format
    const anthropicResponse = convertToAnthropicMessagesResponse(result);

    return c.json(anthropicResponse);
  } catch (error) {
    logger.error("Anthropic Messages API endpoint error:", error);

    let errorMessage = "Failed to process Anthropic Messages API request";
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

// Register Anthropic Messages API routes
export function registerV1ChatMessagesRoutes(app: Hono) {
  // Messages API endpoint - requires authentication (handled in index.ts)
  app.post("/v1/messages", handleAnthropicMessagesEndpoint);
}