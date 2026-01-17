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
 * Parser for Google Antigravity API cooldown messages.
 * Handles patterns like:
 * - "Your quota will reset after 20s"
 * - "reset after 45s"
 * - "reset after 2 minutes"
 */
export class AntigravityCooldownParser implements CooldownParser {
    parseCooldownDuration(errorText: string): number | null {
        try {
            // Pattern 1: "reset after Xs" or "reset after X seconds"
            const secondsMatch = errorText.match(/reset after (\d+)\s*(?:s|seconds?)/i);
            if (secondsMatch?.[1]) {
                const seconds = parseInt(secondsMatch[1], 10);
                return seconds * 1000;
            }

            // Pattern 2: "reset after X minutes" or "reset after X mins"
            const minutesMatch = errorText.match(/reset after (\d+)\s*(?:m|mins?|minutes?)/i);
            if (minutesMatch?.[1]) {
                const minutes = parseInt(minutesMatch[1], 10);
                return minutes * 60 * 1000;
            }

            // Pattern 3: "reset after X hours" or "reset after X hrs"
            const hoursMatch = errorText.match(/reset after (\d+)\s*(?:h|hrs?|hours?)/i);
            if (hoursMatch?.[1]) {
                const hours = parseInt(hoursMatch[1], 10);
                return hours * 60 * 60 * 1000;
            }

            logger.debug(`Unable to parse Antigravity cooldown duration from: ${errorText.substring(0, 100)}`);
            return null;
        } catch (e) {
            logger.error('Error parsing Antigravity cooldown duration', e);
            return null;
        }
    }
}

/**
 * Registry for provider-specific cooldown parsers.
 * Maps provider type to parser implementation.
 */
export class CooldownParserRegistry {
    private static parsers = new Map<string, CooldownParser>();

    static {
        // Register built-in parsers
        CooldownParserRegistry.register('gemini', new AntigravityCooldownParser());
        CooldownParserRegistry.register('antigravity', new AntigravityCooldownParser());
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
