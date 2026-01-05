import { describe, expect, test, mock } from "bun:test";
import { getClientIp } from "../ip";
import { FastifyRequest } from "fastify";

// Helper to create a mock Fastify Request
function createMockRequest(headers: Record<string, string>, ip?: string): FastifyRequest {
    return {
        headers: headers,
        ip: ip || undefined,
        socket: {
            remoteAddress: ip || undefined
        }
    } as unknown as FastifyRequest;
}

describe("getClientIp", () => {
    test("should return null if no headers or socket info", () => {
        const req = createMockRequest({});
        expect(getClientIp(req)).toBeNull();
    });

    test("should prioritize CF-Connecting-IP", () => {
        const req = createMockRequest({
            "cf-connecting-ip": "1.1.1.1",
            "x-forwarded-for": "2.2.2.2"
        });
        expect(getClientIp(req)).toBe("1.1.1.1");
    });

    test("should prioritize True-Client-Ip over X-Forwarded-For", () => {
        const req = createMockRequest({
            "true-client-ip": "3.3.3.3",
            "x-forwarded-for": "2.2.2.2"
        });
        expect(getClientIp(req)).toBe("3.3.3.3");
    });

    test("should prioritize X-Real-IP over X-Forwarded-For", () => {
        const req = createMockRequest({
            "x-real-ip": "4.4.4.4",
            "x-forwarded-for": "2.2.2.2"
        });
        expect(getClientIp(req)).toBe("4.4.4.4");
    });

    test("should parse first IP from X-Forwarded-For", () => {
        const req = createMockRequest({
            "x-forwarded-for": "5.5.5.5, 6.6.6.6"
        });
        expect(getClientIp(req)).toBe("5.5.5.5");
    });

    test("should handle single X-Forwarded-For IP", () => {
        const req = createMockRequest({
            "x-forwarded-for": "5.5.5.5"
        });
        expect(getClientIp(req)).toBe("5.5.5.5");
    });

    test("should check X-Client-IP", () => {
        const req = createMockRequest({
            "x-client-ip": "7.7.7.7"
        });
        expect(getClientIp(req)).toBe("7.7.7.7");
    });

    test("should check Forwarded header", () => {
        const req = createMockRequest({
            "forwarded": "for=8.8.8.8;proto=http"
        });
        expect(getClientIp(req)).toBe("8.8.8.8");
    });

    test("should handle quoted Forwarded header", () => {
        const req = createMockRequest({
            "forwarded": "for=\"9.9.9.9\""
        });
        expect(getClientIp(req)).toBe("9.9.9.9");
    });
});