import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { setConfigForTesting } from "../../config";
import type { UnifiedChatRequest } from "../../types/unified";
import { CooldownManager } from "../cooldown-manager";

const fetchMock: any = mock(async (): Promise<any> => {
  throw new Error("fetch mock not configured for test");
});

global.fetch = fetchMock as any;

function makeConfig(options?: { failoverEnabled?: boolean; targetCount?: number }) {
  const failoverEnabled = options?.failoverEnabled ?? true;
  const targetCount = options?.targetCount ?? 2;

  const providers: Record<string, any> = {
    p1: {
      type: "chat",
      api_base_url: "https://p1.example.com/v1",
      api_key: "test-key-p1",
      models: { "model-1": {} },
    },
    p2: {
      type: "chat",
      api_base_url: "https://p2.example.com/v1",
      api_key: "test-key-p2",
      models: { "model-2": {} },
    },
    p3: {
      type: "chat",
      api_base_url: "https://p3.example.com/v1",
      api_key: "test-key-p3",
      models: { "model-3": {} },
    },
  };

  const orderedTargets = [
    { provider: "p1", model: "model-1" },
    { provider: "p2", model: "model-2" },
    { provider: "p3", model: "model-3" },
  ].slice(0, targetCount);

  return {
    providers,
    models: {
      "test-alias": {
        selector: "in_order",
        targets: orderedTargets,
      },
    },
    keys: {},
    adminKey: "secret",
    failover: {
      enabled: failoverEnabled,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"],
    },
    quotas: [],
  } as any;
}

function makeChatRequest(stream = false): UnifiedChatRequest {
  return {
    model: "test-alias",
    messages: [{ role: "user", content: "hello" }],
    incomingApiType: "chat",
    stream,
  };
}

function successChatResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: "chat.completion",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Dispatcher Failover", () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test("single target, success on first try", async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () => successChatResponse("model-1"));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe("p1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("multiple targets, success on first try", async () => {
    setConfigForTesting(makeConfig({ targetCount: 3 }));
    fetchMock.mockImplementation(async () => successChatResponse("model-1"));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe("p1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock as any).mock.calls[0]?.[0])).toContain("p1.example.com");
  });

  test("multiple targets, failover on retryable failure", async () => {
    setConfigForTesting(makeConfig({ targetCount: 3 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, "upstream boom"))
      .mockImplementationOnce(async () => successChatResponse("model-2"));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe("p2");
    expect(JSON.parse(meta?.allAttemptedProviders || "[]")).toEqual([
      "p1/model-1",
      "p2/model-2",
    ]);
  });

  test("multiple targets, all fail (exhaustion)", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, "first failed"))
      .mockImplementationOnce(async () => errorResponse(503, "second failed"));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error("expected dispatch to fail");
    } catch (error: any) {
      expect(error.message).toContain("All targets failed");
      expect(error.message).toContain("p1/model-1, p2/model-2");
      expect(error.routingContext?.attemptCount).toBe(2);
    }
  });

  test("non-retryable 400 does NOT failover", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(400, "bad request"));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error("expected dispatch to fail");
    } catch (error: any) {
      expect(error.message).toContain("All targets failed");
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test("non-retryable 422 does NOT failover", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(422, "unprocessable"));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error("expected dispatch to fail");
    } catch (error: any) {
      expect(error.message).toContain("All targets failed");
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test("retryable 500 DOES failover", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, "retryable"))
      .mockImplementationOnce(async () => successChatResponse("model-2"));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe("p2");
  });

  test("network error ECONNREFUSED DOES failover", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => {
        const err: any = new Error("connect ECONNREFUSED 127.0.0.1:443");
        err.code = "ECONNREFUSED";
        throw err;
      })
      .mockImplementationOnce(async () => successChatResponse("model-2"));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe("p2");
  });

  test("streaming success on first try", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\\n\\n"));
        controller.close();
      },
    });

    fetchMock.mockImplementation(async () =>
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(response.stream).toBeDefined();
  });

  test("streaming failover before first byte", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const err: any = new Error("connect ECONNREFUSED stream");
        err.code = "ECONNREFUSED";
        controller.error(err);
      },
    });

    const okStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: recovered\\n\\n"));
        controller.close();
      },
    });

    fetchMock
      .mockImplementationOnce(async () =>
        new Response(failingStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
      .mockImplementationOnce(async () =>
        new Response(okStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe("p2");
    expect(response.stream).toBeDefined();
  });

  test("no failover when disabled in config", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2, failoverEnabled: false }));
    fetchMock.mockImplementation(async () => errorResponse(500, "should not retry"));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error("expected dispatch to fail");
    } catch (error: any) {
      expect(error.message).toContain("All targets failed");
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test("embeddings failover", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, "embeddings failed on p1"))
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              object: "list",
              data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
              model: "model-2",
              usage: { prompt_tokens: 2, total_tokens: 2 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
      );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatchEmbeddings({
      model: "test-alias",
      input: "hello",
      originalBody: { input: "hello" },
    } as any);
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe("p2");
    expect(response.data?.[0]?.embedding).toEqual([0.1, 0.2]);
  });

  test("non-retryable 413 (Payload Too Large) does NOT failover", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(413, "payload too large"));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error("expected dispatch to fail");
    } catch (error: any) {
      expect(error.message).toContain("All targets failed");
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(error.routingContext?.statusCode).toBe(413);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test("413 error does NOT trigger cooldown", async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(413, "payload too large"));

    const dispatcher = new Dispatcher();
    const cm = CooldownManager.getInstance();
    
    // Clear any existing cooldowns
    await cm.clearCooldown();

    try {
      await dispatcher.dispatch(makeChatRequest());
    } catch (error: any) {
      // Expected to fail
    }

    // Provider should NOT be on cooldown after 413
    const cooldowns = cm.getCooldowns();
    expect(cooldowns).toHaveLength(0);
  });
});
