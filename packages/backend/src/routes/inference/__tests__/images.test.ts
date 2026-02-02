import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { ImageTransformer } from "../../../transformers/image";
import { DebugManager } from "../../../services/debug-manager";

describe("Images Route Handler", () => {
  describe("ImageTransformer integration", () => {
    let transformer: ImageTransformer;

    beforeEach(() => {
      transformer = new ImageTransformer();
      // Reset DebugManager singleton
      DebugManager.getInstance().setEnabled(false);
    });

    describe("Image Generation", () => {
      it("should parse and transform generation request correctly", async () => {
        const request = {
          model: "flux-2-pro",
          prompt: "A white siamese cat",
          size: "1024x1024",
          n: 1,
          response_format: "url" as const,
        };

        const parsed = await transformer.parseGenerationRequest(request);
        expect(parsed.model).toBe("flux-2-pro");
        expect(parsed.prompt).toBe("A white siamese cat");
        expect(parsed.size).toBe("1024x1024");

        const transformed = await transformer.transformGenerationRequest(parsed);
        expect(transformed.model).toBe("flux-2-pro");
        expect(transformed.prompt).toBe("A white siamese cat");
      });

      it("should handle generation response with URL format", async () => {
        const response = {
          created: 1713833628,
          data: [
            {
              url: "https://api.naga.ac/v1/images/gen_1234567890.png",
              revised_prompt: "A white siamese cat sitting gracefully",
            },
          ],
        };

        const result = await transformer.transformGenerationResponse(response);
        expect(result.created).toBe(1713833628);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.url).toBe("https://api.naga.ac/v1/images/gen_1234567890.png");
        expect(result.data[0]?.revised_prompt).toBe("A white siamese cat sitting gracefully");
      });

      it("should handle generation response with b64_json format", async () => {
        const response = {
          created: 1713833628,
          data: [
            {
              b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          ],
        };

        const result = await transformer.transformGenerationResponse(response);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.b64_json).toBeDefined();
      });

      it("should handle multiple generated images", async () => {
        const response = {
          created: 1713833628,
          data: [
            { url: "https://example.com/image1.png" },
            { url: "https://example.com/image2.png" },
            { url: "https://example.com/image3.png" },
          ],
        };

        const result = await transformer.transformGenerationResponse(response);
        expect(result.data).toHaveLength(3);
      });

      it("should handle generation response with usage data", async () => {
        const response = {
          created: 1713833628,
          data: [{ url: "https://example.com/image.png" }],
          usage: {
            input_tokens: 25,
            output_tokens: 100,
            total_tokens: 125,
          },
        };

        const result = await transformer.transformGenerationResponse(response);
        expect(result.usage?.input_tokens).toBe(25);
        expect(result.usage?.output_tokens).toBe(100);
        expect(result.usage?.total_tokens).toBe(125);
      });
    });

    describe("Image Editing", () => {
      it("should parse edit request fields correctly", async () => {
        const request = {
          model: "gpt-image-1.5",
          prompt: "Add a red hat to the person in the image",
          n: 2,
          size: "1024x1024",
          response_format: "url" as const,
          quality: "high",
        };

        const parsed = await transformer.parseEditRequest(request);
        expect(parsed.model).toBe("gpt-image-1.5");
        expect(parsed.prompt).toBe("Add a red hat to the person in the image");
        expect(parsed.n).toBe(2);
        expect(parsed.size).toBe("1024x1024");
        expect(parsed.response_format).toBe("url");
        expect(parsed.quality).toBe("high");
      });

      it("should transform edit request with image to FormData", async () => {
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const request = {
          model: "gpt-image-1.5",
          prompt: "Change background to beach scene",
          image: imageBuffer,
          filename: "portrait.png",
          mimeType: "image/png",
          n: 1,
          size: "1024x1024",
        };

        const formData = await transformer.transformEditRequest(request as any);
        expect(formData).toBeInstanceOf(FormData);
        expect(formData.get("model")).toBe("gpt-image-1.5");
        expect(formData.get("prompt")).toBe("Change background to beach scene");
        expect(formData.get("n")).toBe("1");
        expect(formData.get("size")).toBe("1024x1024");
        expect(formData.get("image")).toBeDefined();
      });

      it("should transform edit request with mask to FormData", async () => {
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
        const maskBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        const request = {
          model: "gpt-image-1",
          prompt: "Edit only the masked area",
          image: imageBuffer,
          filename: "input.png",
          mimeType: "image/png",
          mask: maskBuffer,
          maskFilename: "mask.png",
          maskMimeType: "image/png",
        };

        const formData = await transformer.transformEditRequest(request as any);
        expect(formData.get("image")).toBeDefined();
        expect(formData.get("mask")).toBeDefined();
      });

      it("should handle edit response", async () => {
        const response = {
          created: 1713833628,
          data: [
            {
              url: "https://example.com/edited_image.png",
              revised_prompt: "Portrait with beach background",
            },
          ],
        };

        const result = await transformer.transformEditResponse(response);
        expect(result.created).toBe(1713833628);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.url).toBe("https://example.com/edited_image.png");
        expect(result.data[0]?.revised_prompt).toBe("Portrait with beach background");
      });

      it("should handle edit response with b64_json", async () => {
        const response = {
          created: 1713833628,
          data: [
            { b64_json: "base64encodedimagedata" },
          ],
        };

        const result = await transformer.transformEditResponse(response);
        expect(result.data[0]?.b64_json).toBe("base64encodedimagedata");
      });

      it("should handle multiple edited images", async () => {
        const response = {
          created: 1713833628,
          data: [
            { url: "https://example.com/edit1.png" },
            { url: "https://example.com/edit2.png" },
          ],
        };

        const result = await transformer.transformEditResponse(response);
        expect(result.data).toHaveLength(2);
      });
    });

    describe("Error handling", () => {
      it("should handle missing optional fields gracefully", async () => {
        const request = {
          model: "dall-e-3",
          prompt: "A simple test",
        };

        const parsed = await transformer.parseGenerationRequest(request);
        expect(parsed.model).toBe("dall-e-3");
        expect(parsed.prompt).toBe("A simple test");
        expect(parsed.n).toBeUndefined();
        expect(parsed.size).toBeUndefined();
        expect(parsed.quality).toBeUndefined();
        expect(parsed.style).toBeUndefined();
      });

      it("should handle edit request without mask", async () => {
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
        const request = {
          model: "dall-e-2",
          prompt: "Extend the image",
          image: imageBuffer,
          filename: "original.png",
          mimeType: "image/png",
        };

        const formData = await transformer.transformEditRequest(request as any);
        expect(formData.get("model")).toBe("dall-e-2");
        expect(formData.get("prompt")).toBe("Extend the image");
        expect(formData.get("image")).toBeDefined();
        expect(formData.get("mask")).toBeNull();
      });

      it("should pass through empty or null values", async () => {
        const request = {
          model: "gpt-image-1",
          prompt: "",
          n: null,
          size: undefined,
        };

        const transformed = await transformer.transformGenerationRequest(request as any);
        expect(transformed.model).toBe("gpt-image-1");
        expect(transformed.prompt).toBe("");
      });
    });

    describe("Transformer properties", () => {
      it("should have correct name", () => {
        expect(transformer.name).toBe("image");
      });

      it("should have correct defaultEndpoint", () => {
        expect(transformer.defaultEndpoint).toBe("/images/generations");
      });
    });

    describe("formatResponse", () => {
      it("should pass through generation response unchanged", async () => {
        const response = {
          created: 1713833628,
          data: [{ url: "https://example.com/image.png" }],
        };

        const formatted = await transformer.formatResponse(response as any);
        expect(formatted).toEqual(response);
      });

      it("should pass through edit response unchanged", async () => {
        const response = {
          created: 1713833628,
          data: [{ url: "https://example.com/edited.png" }],
        };

        const formatted = await transformer.formatResponse(response as any);
        expect(formatted).toEqual(response);
      });
    });
  });
});
