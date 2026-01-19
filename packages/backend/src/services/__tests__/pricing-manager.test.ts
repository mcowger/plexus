import { describe, expect, test, beforeAll } from "bun:test";
import { PricingManager } from "../pricing-manager";
import path from "path";

describe("PricingManager - Model Search", () => {
    let pricingManager: PricingManager;

    beforeAll(async () => {
        pricingManager = PricingManager.getInstance();
        // Load test pricing data
        const testDataPath = path.join(__dirname, "../../utils/__tests__/fixtures/openrouter-models.json");
        await pricingManager.loadPricing(testDataPath);
    });

    test("should return all model slugs when no query provided", () => {
        const slugs = pricingManager.searchModelSlugs("");
        expect(slugs.length).toBeGreaterThan(0);
        expect(Array.isArray(slugs)).toBe(true);
    });

    test("should find models with substring match", () => {
        const slugs = pricingManager.searchModelSlugs("claude");
        expect(slugs.length).toBeGreaterThan(0);
        expect(slugs.every(slug => slug.toLowerCase().includes("claude"))).toBe(true);
    });

    test("should find models with case-insensitive search", () => {
        const lowerCase = pricingManager.searchModelSlugs("claude");
        const upperCase = pricingManager.searchModelSlugs("CLAUDE");
        const mixedCase = pricingManager.searchModelSlugs("ClAuDe");
        
        expect(lowerCase).toEqual(upperCase);
        expect(lowerCase).toEqual(mixedCase);
    });

    test("should prioritize matches that start with query", () => {
        const slugs = pricingManager.searchModelSlugs("anthropic");
        
        // First result should start with "anthropic"
        expect(slugs.length).toBeGreaterThan(0);
        if (slugs.length > 0 && slugs[0]) {
            expect(slugs[0].toLowerCase().startsWith("anthropic")).toBe(true);
        }
    });

    test("should return empty array for non-matching query", () => {
        const slugs = pricingManager.searchModelSlugs("nonexistentmodel12345");
        expect(slugs).toEqual([]);
    });

    test("should find partial model name matches", () => {
        const slugs = pricingManager.searchModelSlugs("sonnet");
        expect(slugs.length).toBeGreaterThan(0);
        expect(slugs.every(slug => slug.toLowerCase().includes("sonnet"))).toBe(true);
    });

    test("should return all slugs via getAllModelSlugs", () => {
        const allSlugs = pricingManager.getAllModelSlugs();
        expect(allSlugs.length).toBeGreaterThan(0);
        expect(Array.isArray(allSlugs)).toBe(true);
    });

    test("should handle special characters in search query", () => {
        const slugs = pricingManager.searchModelSlugs("claude-3.5");
        // Should not throw and should return results if matching models exist
        expect(Array.isArray(slugs)).toBe(true);
    });
});
