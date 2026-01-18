import { MessageContent } from "../../types/unified";
import { formatBase64 } from "../utils";

/**
 * Converts Anthropic's content blocks (text, image) into unified format.
 *
 * Returns:
 * - A single text string if there's only one text block with no cache_control
 * - An array of MessageContent objects otherwise (preserves cache_control tags)
 */
export function convertAnthropicContent(content: any[]): string | MessageContent[] {
  const parts: MessageContent[] = [];

  for (const c of content) {
    if (c.type === "text") {
      parts.push({
        type: "text",
        text: c.text,
        cache_control: c.cache_control,
      });
    } else if (c.type === "image" && c.source) {
      parts.push({
        type: "image_url",
        image_url: {
          url:
            c.source.type === "base64"
              ? formatBase64(c.source.data, c.source.media_type)
              : c.source.url,
        },
        media_type: c.source.media_type,
      });
    }
  }

  if (!parts.length) return "";

  // Optimization: return plain string for single text block without cache control
  const firstPart = parts[0];
  if (parts.length === 1 && firstPart?.type === "text" && !firstPart.cache_control) {
    return firstPart.text;
  }

  return parts;
}
