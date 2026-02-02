import { UnifiedSpeechRequest, UnifiedSpeechResponse } from "../types/unified";

export class SpeechTransformer {
  name = "speech";
  defaultEndpoint = "/audio/speech";

  async parseRequest(input: any): Promise<UnifiedSpeechRequest> {
    return {
      model: input.model,
      input: input.input,
      voice: input.voice,
      instructions: input.instructions,
      response_format: input.response_format,
      speed: input.speed,
      stream_format: input.stream_format,
    };
  }

  async transformRequest(request: UnifiedSpeechRequest): Promise<any> {
    return {
      model: request.model,
      input: request.input,
      voice: request.voice,
      instructions: request.instructions,
      response_format: request.response_format || 'mp3',
      speed: request.speed || 1.0,
    };
  }

  async transformResponse(
    response: Buffer,
    options: { stream_format?: string; response_format?: string }
  ): Promise<UnifiedSpeechResponse> {
    const isStreamed = options.stream_format === 'sse';

    return {
      audio: isStreamed ? undefined : response,
      stream: isStreamed ? response as unknown as ReadableStream : undefined,
      isStreamed,
    };
  }

  async formatResponse(response: UnifiedSpeechResponse): Promise<Buffer | ReadableStream> {
    if (response.stream) {
      return response.stream as unknown as ReadableStream;
    }
    return response.audio!;
  }

  getMimeType(response_format?: string): string {
    const formats: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'opus': 'audio/opus',
      'aac': 'audio/aac',
      'flac': 'audio/flac',
      'wav': 'audio/wav',
      'pcm': 'audio/basic',
    };
    return formats[response_format || 'mp3'] || 'audio/mpeg';
  }

  extractUsage(eventData: string): { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined {
    try {
      const event = JSON.parse(eventData);
      if (event.type === 'speech.audio.done' && event.usage) {
        return event.usage;
      }
    } catch {
    }
    return undefined;
  }
}