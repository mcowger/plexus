import { describe, expect, test, mock } from "bun:test";
import { getClientIp } from "../ip";
import { Context } from "hono";

// Mock hono/bun to ensure clean state for this test suite
mock.module("hono/bun", () => ({
    getConnInfo: () => ({ remote: {} })
}));

// Helper to create a mock Hono Context
function createMockContext(headers: Record<string, string>): Context {
    return {
        req: {
            header: (key: string) => headers[key.toLowerCase()] || undefined,
        },
        env: {}, // Mock env
    } as unknown as Context; // simplified casting
}

// Since we cannot easily mock Hono's Bun adapter's getConnInfo directly in a unit test without more setup,
// we will focus on header parsing logic which is the primary complexity.
// We can mock the module "hono/bun" if needed, but testing headers is sufficient for the logic we own.

describe("getClientIp", () => {
    test("should return null if no headers or socket info", () => {
        const c = createMockContext({});
        expect(getClientIp(c)).toBeNull();
    });

    test("should prioritize CF-Connecting-IP", () => {
        const c = createMockContext({
            "cf-connecting-ip": "1.1.1.1",
            "x-forwarded-for": "2.2.2.2"
        });
        expect(getClientIp(c)).toBe("1.1.1.1");
    });

    test("should prioritize True-Client-Ip over X-Forwarded-For", () => {
        const c = createMockContext({
            "true-client-ip": "3.3.3.3",
            "x-forwarded-for": "2.2.2.2"
        });
        expect(getClientIp(c)).toBe("3.3.3.3");
    });

    test("should prioritize X-Real-IP over X-Forwarded-For", () => {
        const c = createMockContext({
            "x-real-ip": "4.4.4.4",
            "x-forwarded-for": "2.2.2.2"
        });
        expect(getClientIp(c)).toBe("4.4.4.4");
    });

    test("should parse first IP from X-Forwarded-For", () => {
        const c = createMockContext({
            "x-forwarded-for": "5.5.5.5, 6.6.6.6"
        });
        expect(getClientIp(c)).toBe("5.5.5.5");
    });

    test("should handle single X-Forwarded-For IP", () => {
        const c = createMockContext({
            "x-forwarded-for": "5.5.5.5"
        });
        expect(getClientIp(c)).toBe("5.5.5.5");
    });

    test("should check X-Client-IP", () => {
        const c = createMockContext({
            "x-client-ip": "7.7.7.7"
        });
        expect(getClientIp(c)).toBe("7.7.7.7");
    });

    test("should check Forwarded header", () => {
        const c = createMockContext({
            "forwarded": "for=8.8.8.8;proto=http"
        });
        expect(getClientIp(c)).toBe("8.8.8.8");
    });

    test("should handle quoted Forwarded header", () => {
        const c = createMockContext({
            "forwarded": "for=\"9.9.9.9\""
        });
        expect(getClientIp(c)).toBe("9.9.9.9");
    });
});
