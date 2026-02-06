import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as actualPiAi from "@mariozechner/pi-ai";
import { OAuthAuthManager } from "../../services/oauth-auth-manager";

mock.module("@mariozechner/pi-ai", () => ({
  ...actualPiAi,
  getModel: (provider: any, modelId: string) => ({ id: modelId, provider }),
  complete: async () => ({ ok: true }),
  stream: async () => ({ ok: true })
}));

const { OAuthTransformer } = await import("../oauth/oauth-transformer");

describe("OAuthTransformer", () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
  });

  afterEach(() => {
    mock.restore();
    OAuthAuthManager.resetForTesting();
  });

  test("skips proxy renaming for claude code agent headers", async () => {
    const authManager = OAuthAuthManager.getInstance();
    spyOn(authManager, "getApiKey").mockResolvedValue("sk-ant-oat-test");

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: "MyTool" }],
      messages: []
    };

    await transformer.executeRequest(context, "anthropic" as any, "claude-test", false, {
      clientHeaders: { "x-app": "cli" }
    });

    expect(context.tools[0]?.name).toBe("MyTool");
  });

  test("proxies tool names for non-claude code agents", async () => {
    const authManager = OAuthAuthManager.getInstance();
    spyOn(authManager, "getApiKey").mockResolvedValue("sk-ant-oat-test");

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: "MyTool" }],
      messages: []
    };

    await transformer.executeRequest(context, "anthropic" as any, "claude-test", false, {});

    expect(context.tools[0]?.name).toBe("proxy_MyTool");
  });
});
