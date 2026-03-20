import { logger } from '../utils/logger';

/**
 * Interface for provider-specific cooldown duration parsers.
 * Each provider can implement their own parser to extract cooldown duration from error messages.
 */
export interface CooldownParser {
  /**
   * Parse cooldown duration from an error message or response body.
   * @param errorText The error message or response body to parse
   * @returns Cooldown duration in milliseconds, or null if unable to parse
   */
  parseCooldownDuration(errorText: string): number | null;
}

/**
 * Registry for provider-specific cooldown parsers.
 * Maps provider type to parser implementation.
 */
export class CooldownParserRegistry {
  private static parsers = new Map<string, CooldownParser>();

  static {
    // Built-in parser for openai-codex / pi.ai usage limit messages.
    // Matches patterns like "Try again in ~9725 min." or "Try again in ~45 min".
    CooldownParserRegistry.register('openai-codex', {
      parseCooldownDuration(errorText: string): number | null {
        const match = /try again in ~(\d+)\s*min/i.exec(errorText);
        if (!match || !match[1]) return null;
        const minutes = parseInt(match[1], 10);
        return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : null;
      },
    });
  }

  /**
   * Register a cooldown parser for a specific provider type.
   * @param providerType The provider type (e.g., 'gemini', 'openai', 'anthropic')
   * @param parser The parser implementation
   */
  static register(providerType: string, parser: CooldownParser): void {
    this.parsers.set(providerType.toLowerCase(), parser);
    logger.debug(`Registered cooldown parser for provider type: ${providerType}`);
  }

  /**
   * Get the parser for a specific provider type.
   * @param providerType The provider type
   * @returns The parser, or null if none registered
   */
  static getParser(providerType: string): CooldownParser | null {
    return this.parsers.get(providerType.toLowerCase()) || null;
  }

  /**
   * Parse cooldown duration for a specific provider type.
   * Falls back to null if no parser is registered or parsing fails.
   * @param providerType The provider type
   * @param errorText The error message or response body
   * @returns Cooldown duration in milliseconds, or null
   */
  static parseCooldown(providerType: string, errorText: string): number | null {
    const parser = this.getParser(providerType);
    if (!parser) {
      logger.debug(`No cooldown parser registered for provider type: ${providerType}`);
      return null;
    }
    return parser.parseCooldownDuration(errorText);
  }
}
