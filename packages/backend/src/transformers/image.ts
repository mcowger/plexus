import { UnifiedImageGenerationRequest, UnifiedImageGenerationResponse, UnifiedImageEditRequest, UnifiedImageEditResponse } from "../types/unified";

export class ImageTransformer {
  name = "image";
  defaultEndpoint = "/images/generations";

  async parseGenerationRequest(input: any): Promise<UnifiedImageGenerationRequest> {
    return {
      model: input.model,
      prompt: input.prompt,
      n: input.n,
      size: input.size,
      response_format: input.response_format,
      quality: input.quality,
      style: input.style,
      user: input.user,
    };
  }

  async transformGenerationRequest(request: UnifiedImageGenerationRequest): Promise<any> {
    return {
      model: request.model,
      prompt: request.prompt,
      n: request.n,
      size: request.size,
      response_format: request.response_format,
      quality: request.quality,
      style: request.style,
      user: request.user,
    };
  }

  async transformGenerationResponse(response: any): Promise<UnifiedImageGenerationResponse> {
    return {
      created: response.created,
      data: response.data,
      usage: response.usage,
    };
  }

  async parseEditRequest(input: any): Promise<Partial<UnifiedImageEditRequest>> {
    return {
      model: input.model,
      prompt: input.prompt,
      n: input.n,
      size: input.size,
      response_format: input.response_format,
      quality: input.quality,
      user: input.user,
    };
  }

  async transformEditRequest(request: UnifiedImageEditRequest): Promise<FormData> {
    const formData = new FormData();

    formData.append('model', request.model);
    formData.append('prompt', request.prompt);
    
    if (request.n !== undefined) formData.append('n', request.n.toString());
    if (request.size !== undefined) formData.append('size', request.size);
    if (request.response_format !== undefined) formData.append('response_format', request.response_format);
    if (request.quality !== undefined) formData.append('quality', request.quality);
    if (request.user !== undefined) formData.append('user', request.user);

    // Append image file - use Uint8Array for Blob compatibility
    const imageBuffer = new Uint8Array(request.image);
    const imageBlob = new Blob([imageBuffer], { type: request.mimeType });
    formData.append('image', imageBlob, request.filename);

    // Append mask if provided
    if (request.mask && request.maskFilename) {
      const maskBuffer = new Uint8Array(request.mask);
      const maskBlob = new Blob([maskBuffer], { type: request.maskMimeType || 'image/png' });
      formData.append('mask', maskBlob, request.maskFilename);
    }

    return formData;
  }

  async transformEditResponse(response: any): Promise<UnifiedImageEditResponse> {
    return {
      created: response.created,
      data: response.data,
      usage: response.usage,
    };
  }

  formatResponse(response: UnifiedImageGenerationResponse | UnifiedImageEditResponse): any {
    return response;
  }
}
