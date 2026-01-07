import { describe, expect, test } from "bun:test";
import { AntigravityCooldownParser, CooldownParserRegistry } from "../cooldown-parsers";

describe("AntigravityCooldownParser", () => {
    const parser = new AntigravityCooldownParser();

    describe("Seconds pattern parsing", () => {
        test("Parses 'reset after Xs' format", () => {
            const errorText = "You have exhausted your capacity on this model. Your quota will reset after 20s.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(20000); // 20 seconds = 20000ms
        });

        test("Parses 'reset after X seconds' format", () => {
            const errorText = "Rate limit exceeded. Your quota will reset after 45 seconds.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(45000); // 45 seconds = 45000ms
        });

        test("Parses 'reset after X second' (singular) format", () => {
            const errorText = "Quota exceeded. reset after 1 second.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(1000); // 1 second = 1000ms
        });

        test("Handles different spacing around 's'", () => {
            const errorText1 = "reset after 30s";
            const errorText2 = "reset after 30 s";
            const errorText3 = "reset after 30  s"; // extra spaces

            expect(parser.parseCooldownDuration(errorText1)).toBe(30000);
            expect(parser.parseCooldownDuration(errorText2)).toBe(30000);
            expect(parser.parseCooldownDuration(errorText3)).toBe(30000);
        });

        test("Case-insensitive matching", () => {
            const errorText1 = "Reset After 20S.";
            const errorText2 = "RESET AFTER 20 SECONDS";

            expect(parser.parseCooldownDuration(errorText1)).toBe(20000);
            expect(parser.parseCooldownDuration(errorText2)).toBe(20000);
        });
    });

    describe("Minutes pattern parsing", () => {
        test("Parses 'reset after X minutes' format", () => {
            const errorText = "Rate limit exceeded. Your quota will reset after 2 minutes.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(120000); // 2 minutes = 120000ms
        });

        test("Parses 'reset after Xm' format", () => {
            const errorText = "Quota exceeded. reset after 5m.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(300000); // 5 minutes = 300000ms
        });

        test("Parses 'reset after X min' format", () => {
            const errorText = "Quota exceeded. reset after 10 min.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(600000); // 10 minutes = 600000ms
        });

        test("Parses 'reset after X mins' format", () => {
            const errorText = "Quota exceeded. reset after 3 mins.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(180000); // 3 minutes = 180000ms
        });

        test("Handles singular 'minute'", () => {
            const errorText = "Rate limit. Reset after 1 minute.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(60000); // 1 minute = 60000ms
        });
    });

    describe("Hours pattern parsing", () => {
        test("Parses 'reset after X hours' format", () => {
            const errorText = "Daily limit reached. Quota reset after 2 hours.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(7200000); // 2 hours = 7200000ms
        });

        test("Parses 'reset after Xh' format", () => {
            const errorText = "Quota exceeded. reset after 1h.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(3600000); // 1 hour = 3600000ms
        });

        test("Parses 'reset after X hrs' format", () => {
            const errorText = "Quota exceeded. reset after 3 hrs.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(10800000); // 3 hours = 10800000ms
        });

        test("Handles singular 'hour'", () => {
            const errorText = "Rate limit. Reset after 1 hour.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(3600000); // 1 hour = 3600000ms
        });
    });

    describe("Edge cases and error handling", () => {
        test("Returns null for unrecognized format", () => {
            const errorText = "Rate limit exceeded. Please try again later.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(null);
        });

        test("Returns null for empty string", () => {
            const result = parser.parseCooldownDuration("");
            expect(result).toBe(null);
        });

        test("Returns null when no duration found", () => {
            const errorText = "Your quota has been exhausted.";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(null);
        });

        test("Prioritizes first match when multiple patterns present", () => {
            // Seconds pattern comes first in regex order
            const errorText = "reset after 30s and also 2 minutes";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(30000); // Should match seconds pattern first
        });

        test("Handles large duration values", () => {
            const errorText = "Rate limit. Reset after 1440 minutes."; // 24 hours in minutes
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(86400000); // 24 hours = 86400000ms
        });

        test("Parses zero duration (edge case)", () => {
            const errorText = "reset after 0s";
            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(0);
        });
    });

    describe("Real-world error message examples", () => {
        test("Google Antigravity actual error format", () => {
            const errorText = JSON.stringify({
                error: {
                    code: 429,
                    message: "You have exhausted your capacity on this model. Your quota will reset after 45s.",
                    status: "RESOURCE_EXHAUSTED"
                }
            });

            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(45000);
        });

        test("Alternative Google format with minutes", () => {
            const errorText = JSON.stringify({
                error: {
                    code: 429,
                    message: "Resource exhausted. Quota reset after 2 minutes.",
                    status: "RESOURCE_EXHAUSTED"
                }
            });

            const result = parser.parseCooldownDuration(errorText);
            expect(result).toBe(120000);
        });
    });
});

describe("CooldownParserRegistry", () => {
    test("Returns registered parser for gemini provider type", () => {
        const errorText = "reset after 20s";
        const result = CooldownParserRegistry.parseCooldown('gemini', errorText);
        expect(result).toBe(20000);
    });

    test("Returns registered parser for antigravity provider type", () => {
        const errorText = "reset after 30s";
        const result = CooldownParserRegistry.parseCooldown('antigravity', errorText);
        expect(result).toBe(30000);
    });

    test("Returns null for unregistered provider type", () => {
        const errorText = "reset after 20s";
        const result = CooldownParserRegistry.parseCooldown('unknown-provider', errorText);
        expect(result).toBe(null);
    });

    test("Case-insensitive provider type lookup", () => {
        const errorText = "reset after 45s";
        const result1 = CooldownParserRegistry.parseCooldown('GEMINI', errorText);
        const result2 = CooldownParserRegistry.parseCooldown('Gemini', errorText);
        const result3 = CooldownParserRegistry.parseCooldown('gemini', errorText);

        expect(result1).toBe(45000);
        expect(result2).toBe(45000);
        expect(result3).toBe(45000);
    });

    test("Returns null when parser returns null", () => {
        const errorText = "Unknown error format";
        const result = CooldownParserRegistry.parseCooldown('gemini', errorText);
        expect(result).toBe(null);
    });
});
