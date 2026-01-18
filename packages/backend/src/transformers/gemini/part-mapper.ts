import { Part } from "@google/genai";
import { MessageContent } from "../../types/unified";

/**
 * Converts Gemini Part objects to unified MessageContent format.
 *
 * Handles:
 * - text parts
 * - inlineData (base64 images)
 * - fileData (file URIs)
 * - thought parts (reasoning content)
 */
export function convertGeminiPartsToUnified(
  parts: Part[],
  onThinking?: (text: string, signature?: string) => void
): MessageContent[] {
  const contentParts: MessageContent[] = [];

  parts.forEach((part) => {
    if (part.text) {
      // @ts-ignore - Check for internal 'thought' flag used by some Gemini versions
      if (part.thought && onThinking) {
        // @ts-ignore
        onThinking(part.text, part.thoughtSignature);
      } else {
        contentParts.push({ type: "text", text: part.text });
      }
    } else if (part.inlineData) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
        media_type: part.inlineData.mimeType,
      });
    } else if (part.fileData) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: part.fileData.fileUri || "",
        },
        media_type: part.fileData.mimeType,
      });
    }
  });

  return contentParts;
}

/**
 * Converts unified MessageContent to Gemini Part format.
 */
export function convertUnifiedPartsToGemini(content: string | MessageContent[]): Part[] {
  const parts: Part[] = [];

  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    content.forEach((c) => {
      if (c.type === "text") {
        parts.push({ text: c.text });
      } else if (c.type === "image_url") {
        if (c.image_url.url.startsWith("data:")) {
          const [meta, data] = c.image_url.url.split(",");
          parts.push({
            inlineData: { mimeType: "image/jpeg", data: data || "" },
          });
        } else {
          parts.push({
            fileData: {
              mimeType: c.media_type || "image/jpeg",
              fileUri: c.image_url.url,
            },
          });
        }
      }
    });
  }

  return parts;
}
