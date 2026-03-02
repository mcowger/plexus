/**
 * Patterns to detect quota/balance-related errors in 400 Bad Request responses.
 * Some providers return 400 instead of 402 for quota exhaustion.
 */
export const QUOTA_ERROR_PATTERNS = [
  'insufficient_quota',
  'credit balance is too low',
  'used up your points',
  'quota exceeded',
  'out of credits',
  'balance too low',
  'insufficient balance',
  'insufficient funds',
  'account balance',
  'quota limit',
  'usage limit',
];

/**
 * Default prompt for vision-to-text conversion.
 */
export const DEFAULT_VISION_DESCRIPTION_PROMPT = `Please provide a comprehensive and detailed description of this image for a highly intelligent text-only language model.

Your description should include:
1. **Overall Context**: What is the primary subject or scene?
2. **Visual Layout**: Where are key elements positioned?
3. **Important Details**: Text (OCR), colors, textures, and specific objects.
4. **Atmosphere/Style**: Mood, lighting, and artistic style if applicable.
5. **Action/Dynamics**: What is happening in the scene?

Focus on information that is critical for understanding the image's meaning or answering questions about it. Avoid generic descriptions; be precise and descriptive.`;
