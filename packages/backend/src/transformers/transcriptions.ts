import { UnifiedTranscriptionRequest, UnifiedTranscriptionResponse } from "../types/unified";

/**
 * TranscriptionsTransformer
 * 
 * Pass-through transformer for audio transcriptions.
 * The OpenAI transcriptions API format is standardized, so we forward
 * multipart/form-data requests directly to the provider.
 */
export class TranscriptionsTransformer {
  name = "transcriptions";
  defaultEndpoint = "/audio/transcriptions";

  /**
   * Parse incoming multipart form data into UnifiedTranscriptionRequest
   */
  async parseRequest(
    file: Buffer,
    filename: string,
    mimeType: string,
    fields: Record<string, any>
  ): Promise<UnifiedTranscriptionRequest> {
    return {
      file,
      filename,
      mimeType,
      model: fields.model,
      language: fields.language,
      prompt: fields.prompt,
      response_format: fields.response_format || 'json',
      temperature: fields.temperature ? parseFloat(fields.temperature) : undefined,
    };
  }

  /**
   * Transform unified request to provider-specific multipart/form-data
   * For OpenAI-compatible providers, this is a pass-through
   */
  async transformRequest(request: UnifiedTranscriptionRequest): Promise<FormData> {
    const formData = new FormData();
    
    // Add the audio file as a Blob
    // Convert Buffer to Uint8Array which is compatible with File constructor
    const uint8Array = new Uint8Array(request.file);
    const file = new File([uint8Array], request.filename, { type: request.mimeType });
    formData.append('file', file);
    
    // Add required fields
    formData.append('model', request.model);
    
    // Add optional fields
    if (request.language) {
      formData.append('language', request.language);
    }
    if (request.prompt) {
      formData.append('prompt', request.prompt);
    }
    if (request.response_format) {
      formData.append('response_format', request.response_format);
    }
    if (request.temperature !== undefined) {
      formData.append('temperature', request.temperature.toString());
    }
    
    return formData;
  }

  /**
   * Transform provider response to unified format
   */
  async transformResponse(
    response: any,
    format: string
  ): Promise<UnifiedTranscriptionResponse> {
    if (format === 'text') {
      // For text format, response is just a plain string
      return {
        text: typeof response === 'string' ? response : response.text || '',
      };
    }
    
    // For JSON format, response should have text and optional usage
    return {
      text: response.text || '',
      usage: response.usage ? {
        input_tokens: response.usage.input_tokens || 0,
        output_tokens: response.usage.output_tokens || 0,
        total_tokens: response.usage.total_tokens || 0,
      } : undefined,
    };
  }

  /**
   * Format unified response for the client
   */
  async formatResponse(
    response: UnifiedTranscriptionResponse,
    format: string
  ): Promise<any> {
    if (format === 'text') {
      // Return just the text string
      return response.text;
    }
    
    // For JSON format, return the object (excluding plexus metadata)
    const result: any = {
      text: response.text,
    };
    
    if (response.usage) {
      result.usage = response.usage;
    }
    
    return result;
  }

  /**
   * Transcriptions don't support streaming in v1, so this returns undefined
   */
  extractUsage(eventData: string) {
    return undefined;
  }
}
