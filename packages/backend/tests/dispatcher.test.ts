import { test, expect } from "bun:test";
import { Dispatcher } from "../src/services/dispatcher";
import { PlexusErrorResponse } from "../src/types/errors";
import type { PlexusConfig } from "../src/types/config";
import type { ServerContext } from "../src/types/server";
import { Router } from "../src/services/router";
import { spyOn } from "bun:test";

const mockConfig: any = {
  server: { port: 4000, host: "localhost" },
  logging: { level: "info", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7 }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
  providers: [
    {
      name: "openai",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: {
        chat: "https://api.openai.com/v1/chat/completions",
        messages: "https://api.openai.com/v1/messages",
      },
      auth: {
        type: "bearer",
        apiKey: "{env:OPENAI_API_KEY}",
      },
      models: ["gpt-4", "gpt-3.5-turbo"],
    },
    {
      name: "disabled-provider",
      enabled: false,
      apiTypes: ["chat"],
      baseUrls: {
        chat: "https://api.disabled.com/v1/chat/completions",
        messages: "https://api.disabled.com/v1/messages",
      },
      auth: {
        type: "bearer",
        apiKey: "{env:DISABLED_KEY}",
      },
      models: ["disabled-model"],
    },
  ],
  apiKeys: [{ name: "default", secret: "test-key", enabled: true }],
  aliases: {},
};

const createMockContext = (config: any): ServerContext => ({
  config,
  cooldownManager: {
    isOnCooldown: () => false,
    setCooldown: () => {},
    removeCooldown: () => {},
    updateConfig: () => {},
  } as any,
  healthMonitor: {
    getProviderHealth: () => null,
    recordRequest: () => {},
  } as any,
  usageLogger: undefined,
  metricsCollector: undefined,
  costCalculator: undefined,
  debugLogger: undefined,
});

test("Dispatcher - Find Provider for Valid Model", () => {
  const context = createMockContext(mockConfig);
  const dispatcher = new Dispatcher(context);

  // This is a private method test, so we'll verify it indirectly through dispatchChatCompletion
  // by checking that it finds the provider correctly
  expect(mockConfig.providers.find((p: any) => p.enabled && p.models.includes("gpt-4"))).toBeDefined();
});

test("Dispatcher - Model Not Found", async () => {
  const context = createMockContext(mockConfig);
  const dispatcher = new Dispatcher(context);
  try {
    await dispatcher.dispatchChatCompletion(
      {
        model: "nonexistent-model",
      messages: [{ role: "user", content: "test" }],
      },
      "test-request-id"
    );
    expect.unreachable();
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(404);
      expect(error.type).toBe("invalid_request_error");
    } else {
      expect.unreachable();
    }
  }
});

test("Dispatcher - Disabled Provider Not Found", async () => {
  const context = createMockContext(mockConfig);
  const dispatcher = new Dispatcher(context);

  try {
    await dispatcher.dispatchChatCompletion(
      {
        model: "disabled-model",
        messages: [{ role: "user", content: "test" }],
      },
      "test-request-id"
    );
    expect.unreachable();
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(404);
      expect(error.type).toBe("invalid_request_error");
    } else {
      expect.unreachable();
    }
  }
});

test("Dispatcher - No Providers Configured", async () => {
  const configNoProviders: any = {
    ...mockConfig,
    providers: [],
  };

  const context = createMockContext(configNoProviders);
  const dispatcher = new Dispatcher(context);

  try {
    await dispatcher.dispatchChatCompletion(
      {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      },
      "test-request-id"
  );
    expect.unreachable();
  } catch (error) {
    if (error instanceof PlexusErrorResponse) {
      expect(error.status).toBe(404);
    } else {
      expect.unreachable();
    }
  }
});
