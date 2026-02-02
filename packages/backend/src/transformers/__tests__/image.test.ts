import { describe, it, expect, beforeEach } from "bun:test";
import { ImageTransformer } from "../image";

describe("ImageTransformer", () => {
  let transformer: ImageTransformer;

  beforeEach(() => {
    transformer = new ImageTransformer();
  });

  describe("parseGenerationRequest", () => {
    it("should parse valid OpenAI image generation request", async () => {
      const request = {
        model: "dall-e-3",
        prompt: "A white siamese cat",
        n: 1,
        size: "1024x1024",
        response_format: "url",
        quality: "standard",
        style: "vivid",
      };

      const result = await transformer.parseGenerationRequest(request);

      expect(result.model).toBe("dall-e-3");
      expect(result.prompt).toBe("A white siamese cat");
      expect(result.n).toBe(1);
      expect(result.size).toBe("1024x1024");
      expect(result.response_format).toBe("url");
      expect(result.quality).toBe("standard");
      expect(result.style).toBe("vivid");
    });

    it("should parse minimal request with required fields only", async () => {
      const request = {
        model: "flux-1-schnell",
        prompt: "A beautiful sunset",
      };

      const result = await transformer.parseGenerationRequest(request);

      expect(result.model).toBe("flux-1-schnell");
      expect(result.prompt).toBe("A beautiful sunset");
      expect(result.n).toBeUndefined();
      expect(result.size).toBeUndefined();
    });

    it("should handle request with user field", async () => {
      const request = {
        model: "gpt-image-1",
        prompt: "Test image",
        user: "user_123",
      };

      const result = await transformer.parseGenerationRequest(request);

      expect(result.user).toBe("user_123");
    });
  });

  describe("transformGenerationRequest", () => {
    it("should transform request for provider passthrough", async () => {
      const request = {
        model: "dall-e-3",
        prompt: "A cute baby sea otter",
        n: 1,
        size: "1024x1024",
        response_format: "url" as const,
      };

      const result = await transformer.transformGenerationRequest(request);

      expect(result.model).toBe("dall-e-3");
      expect(result.prompt).toBe("A cute baby sea otter");
      expect(result.n).toBe(1);
      expect(result.size).toBe("1024x1024");
      expect(result.response_format).toBe("url");
    });

    it("should pass through all optional parameters", async () => {
      const request = {
        model: "gpt-image-1.5",
        prompt: "Test",
        quality: "high",
        style: "natural",
        user: "user_456",
      };

      const result = await transformer.transformGenerationRequest(request);

      expect(result.quality).toBe("high");
      expect(result.style).toBe("natural");
      expect(result.user).toBe("user_456");
    });
  });

  describe("transformGenerationResponse", () => {
    it("should handle url response format", async () => {
      const response = {
        created: 1713833628,
        data: [
          {
            url: "https://example.com/image.png",
            revised_prompt: "A white siamese cat sitting on a couch",
          },
        ],
      };

      const result = await transformer.transformGenerationResponse(response);

      expect(result.created).toBe(1713833628);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.url).toBe("https://example.com/image.png");
      expect(result.data[0]?.revised_prompt).toBe("A white siamese cat sitting on a couch");
    });

    it("should handle b64_json response format", async () => {
      const response = {
        created: 1713833628,
        data: [
          {
            b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
        ],
        usage: {
          input_tokens: 50,
          output_tokens: 100,
          total_tokens: 150,
        },
      };

      const result = await transformer.transformGenerationResponse(response);

      expect(result.data[0]?.b64_json).toBeDefined();
      expect(result.usage?.total_tokens).toBe(150);
    });

    it("should handle multiple images", async () => {
      const response = {
        created: 1713833628,
        data: [
          { url: "https://example.com/image1.png" },
          { url: "https://example.com/image2.png" },
        ],
      };

      const result = await transformer.transformGenerationResponse(response);

      expect(result.data).toHaveLength(2);
    });
  });

  describe("parseEditRequest", () => {
    it("should parse image edit request fields", async () => {
      const request = {
        model: "gpt-image-1.5",
        prompt: "Add a hat to the person",
        n: 2,
        size: "1024x1024",
        response_format: "url",
      };

      const result = await transformer.parseEditRequest(request);

      expect(result.model).toBe("gpt-image-1.5");
      expect(result.prompt).toBe("Add a hat to the person");
      expect(result.n).toBe(2);
      expect(result.size).toBe("1024x1024");
      expect(result.response_format).toBe("url");
    });

    it("should handle minimal edit request", async () => {
      const request = {
        model: "dall-e-2",
        prompt: "Change background to blue",
      };

      const result = await transformer.parseEditRequest(request);

      expect(result.model).toBe("dall-e-2");
      expect(result.prompt).toBe("Change background to blue");
    });
  });

  describe("transformEditRequest", () => {
    it("should transform to FormData with image", async () => {
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG header
      const request = {
        model: "gpt-image-1.5",
        prompt: "Add sunglasses",
        image: imageBuffer,
        filename: "input.png",
        mimeType: "image/png",
        n: 1,
      };

      const result = await transformer.transformEditRequest(request as any);

      expect(result).toBeInstanceOf(FormData);
      expect(result.get("model")).toBe("gpt-image-1.5");
      expect(result.get("prompt")).toBe("Add sunglasses");
      expect(result.get("n")).toBe("1");
    });

    it("should include optional parameters in FormData", async () => {
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const request = {
        model: "gpt-image-1.5",
        prompt: "Edit the image",
        image: imageBuffer,
        filename: "input.png",
        mimeType: "image/png",
        size: "1024x1024",
        response_format: "b64_json",
        quality: "high",
        user: "user_123",
      };

      const result = await transformer.transformEditRequest(request as any);

      expect(result.get("size")).toBe("1024x1024");
      expect(result.get("response_format")).toBe("b64_json");
      expect(result.get("quality")).toBe("high");
      expect(result.get("user")).toBe("user_123");
    });

    it("should include mask when provided", async () => {
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const maskBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const request = {
        model: "gpt-image-1",
        prompt: "Edit masked area",
        image: imageBuffer,
        filename: "input.png",
        mimeType: "image/png",
        mask: maskBuffer,
        maskFilename: "mask.png",
        maskMimeType: "image/png",
      };

      const result = await transformer.transformEditRequest(request as any);

      expect(result.get("mask")).toBeDefined();
    });
  });

  describe("transformEditResponse", () => {
    it("should handle image edit response", async () => {
      const response = {
        created: 1713833628,
        data: [
          {
            url: "https://example.com/edited.png",
            revised_prompt: "Person with sunglasses",
          },
        ],
      };

      const result = await transformer.transformEditResponse(response);

      expect(result.created).toBe(1713833628);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.url).toBe("https://example.com/edited.png");
      expect(result.data[0]?.revised_prompt).toBe("Person with sunglasses");
    });

    it("should handle edit response with usage", async () => {
      const response = {
        created: 1713833628,
        data: [{ b64_json: "base64data" }],
        usage: {
          input_tokens: 75,
          output_tokens: 150,
          total_tokens: 225,
        },
      };

      const result = await transformer.transformEditResponse(response);

      expect(result.usage?.total_tokens).toBe(225);
    });
  });

  describe("formatResponse", () => {
    it("should return response as-is for passthrough", async () => {
      const response = {
        created: 1713833628,
        data: [{ url: "https://example.com/image.png" }],
      };

      const result = await transformer.formatResponse(response);

      expect(result).toEqual(response);
    });
  });

  describe("defaultEndpoint", () => {
    it("should have correct default endpoint", () => {
      expect(transformer.defaultEndpoint).toBe("/images/generations");
    });
  });

  describe("name", () => {
    it("should have correct transformer name", () => {
      expect(transformer.name).toBe("image");
    });
  });
});
