import { test, expect } from "bun:test";
import { validateAuthHeader } from "../src/middleware/auth";
import { PlexusErrorResponse } from "../src/types/errors";
import type { ApiKeyConfig } from "../src/types/config";

const mockApiKeys: ApiKeyConfig[] = [
  { name: "default", secret: "valid-key-123", enabled: true },
  { name: "disabled", secret: "disabled-key", enabled: false },
];

test("Auth Middleware - Valid Bearer Token", () => {
  const req = new Request("http://localhost/test", {
    headers: { authorization: "Bearer valid-key-123" },
  });

  const result = validateAuthHeader(req, mockApiKeys);
  expect(result.isAuthenticated).toBe(true);
  expect(result.apiKeyName).toBe("default");
});

test("Auth Middleware - Missing Authorization Header", () => {
  const req = new Request("http://localhost/test", { headers: {} });

  expect(() => validateAuthHeader(req, mockApiKeys)).toThrow(PlexusErrorResponse);
  try {
    validateAuthHeader(req, mockApiKeys);
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(401);
      expect(error.type).toBe("authentication_error");
    }
  }
});

test("Auth Middleware - Invalid Bearer Format", () => {
  const req = new Request("http://localhost/test", {
    headers: { authorization: "Basic invalid" },
  });

  expect(() => validateAuthHeader(req, mockApiKeys)).toThrow(PlexusErrorResponse);
  try {
    validateAuthHeader(req, mockApiKeys);
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(401);
      expect(error.type).toBe("authentication_error");
    }
  }
});

test("Auth Middleware - Invalid API Key", () => {
  const req = new Request("http://localhost/test", {
    headers: { authorization: "Bearer wrong-key" },
  });

  expect(() => validateAuthHeader(req, mockApiKeys)).toThrow(PlexusErrorResponse);
  try {
    validateAuthHeader(req, mockApiKeys);
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(401);
      expect(error.type).toBe("authentication_error");
    }
  }
});

test("Auth Middleware - Disabled API Key", () => {
  const req = new Request("http://localhost/test", {
    headers: { authorization: "Bearer disabled-key" },
  });

  expect(() => validateAuthHeader(req, mockApiKeys)).toThrow(PlexusErrorResponse);
  try {
    validateAuthHeader(req, mockApiKeys);
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(401);
      expect(error.type).toBe("authentication_error");
    }
  }
});

test("Auth Middleware - Malformed Header (no space)", () => {
  const req = new Request("http://localhost/test", {
    headers: { authorization: "Bearervalid-key-123" },
  });

  expect(() => validateAuthHeader(req, mockApiKeys)).toThrow(PlexusErrorResponse);
  try {
    validateAuthHeader(req, mockApiKeys);
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(401);
    }
  }
});
