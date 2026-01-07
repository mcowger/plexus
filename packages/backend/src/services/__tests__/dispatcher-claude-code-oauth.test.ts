import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { setConfigForTesting } from "../../config";
import { UsageStorageService } from "../usage-storage";

// Mock fetch
const fetchMock = mock(async (url: string, options: any) => {
  return new Response(JSON.stringify({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Test response" }],
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});
global.fetch = fetchMock;

describe("Dispatcher - Claude Code OAuth System Instruction Injection (Pass-through)", () => {
  let dispatcher: Dispatcher;
  let mockStorage: UsageStorageService;

  beforeEach(() => {
    fetchMock.mockClear();

    // Create mock storage with Claude Code OAuth credentials
    mockStorage = {
      getOAuthCredential: (provider: string, accountId?: string) => {
        const credentials: Record<string, any> = {
          'claude@example.com': {
            provider: 'claude-code',
            user_identifier: 'claude@example.com',
            access_token: 'claude_access_token_123',
            refresh_token: 'claude_refresh_token_123',
            token_type: 'Bearer',
            expires_at: Date.now() + 3600000,
            metadata: JSON.stringify({
              account_uuid: 'b37bb5b5-6c73-4586-94c4-44313833d598',
              organization_uuid: 'org-123',
              organization_name: 'Test Org'
            })
          }
        };
        return accountId ? credentials[accountId] : credentials['claude@example.com'];
      },
      getAllOAuthCredentials: (provider: string) => {
        return [
          {
            provider: 'claude-code',
            user_identifier: 'claude@example.com',
            access_token: 'claude_access_token_123',
            metadata: JSON.stringify({
              account_uuid: 'b37bb5b5-6c73-4586-94c4-44313833d598'
            })
          }
        ];
      }
    } as any;

    dispatcher = new Dispatcher();
    dispatcher.setUsageStorage(mockStorage);
  });

  test("should inject Claude Code system instruction in pass-through mode", async () => {
    const mockConfig = {
      providers: {
        'claude-code-provider': {
          type: 'messages',
          api_base_url: 'https://api.anthropic.com',
          oauth_provider: 'claude-code',
          oauth_account_pool: ['claude@example.com'],
          models: ['claude-sonnet-4-5-20250929']
        }
      },
      models: {
        'claude-sonnet-4': {
          targets: [
            { provider: 'claude-code-provider', model: 'claude-sonnet-4-5-20250929' }
          ]
        }
      },
      keys: {},
      adminKey: "secret"
    };

    setConfigForTesting(mockConfig as any);

    const request = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 1024,
      stream: false,
      incomingApiType: 'messages',
      originalBody: {
        model: 'claude-sonnet-4',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
        ],
        max_tokens: 1024
      }
    };

    await dispatcher.dispatch(request);

    // Check that fetch was called
    expect(fetchMock).toHaveBeenCalled();

    // Get the request body that was sent
    const fetchCall = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    // Verify system instruction was injected
    expect(requestBody.system).toBeDefined();
    expect(Array.isArray(requestBody.system)).toBe(true);
    expect(requestBody.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude."
    });

    // Verify metadata.user_id is present
    expect(requestBody.metadata).toBeDefined();
    expect(requestBody.metadata.user_id).toBeDefined();
    expect(requestBody.metadata.user_id).toMatch(/^user_[a-f0-9]{64}_account_b37bb5b5-6c73-4586-94c4-44313833d598_session_[a-f0-9-]+$/);
  });

  test("should prepend Claude Code instruction to existing system message in pass-through", async () => {
    const mockConfig = {
      providers: {
        'claude-code-provider': {
          type: 'messages',
          api_base_url: 'https://api.anthropic.com',
          oauth_provider: 'claude-code',
          oauth_account_pool: ['claude@example.com'],
          models: ['claude-sonnet-4-5-20250929']
        }
      },
      models: {
        'claude-sonnet-4': {
          targets: [
            { provider: 'claude-code-provider', model: 'claude-sonnet-4-5-20250929' }
          ]
        }
      },
      keys: {},
      adminKey: "secret"
    };

    setConfigForTesting(mockConfig as any);

    const request = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 1024,
      stream: false,
      incomingApiType: 'messages',
      originalBody: {
        model: 'claude-sonnet-4',
        system: [{ type: 'text', text: 'You are a helpful assistant.' }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
        ],
        max_tokens: 1024
      }
    };

    await dispatcher.dispatch(request);

    const fetchCall = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    // Verify Claude Code instruction is first
    expect(requestBody.system).toBeDefined();
    expect(Array.isArray(requestBody.system)).toBe(true);
    expect(requestBody.system).toHaveLength(2);

    expect(requestBody.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude."
    });

    expect(requestBody.system[1]).toEqual({
      type: "text",
      text: "You are a helpful assistant."
    });
  });

  test("should handle string system message in pass-through", async () => {
    const mockConfig = {
      providers: {
        'claude-code-provider': {
          type: 'messages',
          api_base_url: 'https://api.anthropic.com',
          oauth_provider: 'claude-code',
          oauth_account_pool: ['claude@example.com'],
          models: ['claude-sonnet-4-5-20250929']
        }
      },
      models: {
        'claude-sonnet-4': {
          targets: [
            { provider: 'claude-code-provider', model: 'claude-sonnet-4-5-20250929' }
          ]
        }
      },
      keys: {},
      adminKey: "secret"
    };

    setConfigForTesting(mockConfig as any);

    const request = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 1024,
      stream: false,
      incomingApiType: 'messages',
      originalBody: {
        model: 'claude-sonnet-4',
        system: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
        ],
        max_tokens: 1024
      }
    };

    await dispatcher.dispatch(request);

    const fetchCall = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    // Should convert string to array format with Claude Code instruction first
    expect(requestBody.system).toBeDefined();
    expect(Array.isArray(requestBody.system)).toBe(true);
    expect(requestBody.system).toHaveLength(2);

    expect(requestBody.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude."
    });

    expect(requestBody.system[1]).toEqual({
      type: "text",
      text: "You are a helpful assistant."
    });
  });

  test("should not inject system instruction for non-Claude-Code OAuth providers", async () => {
    // Create mock storage with non-Claude-Code OAuth credentials
    const nonClaudeStorage = {
      getOAuthCredential: (provider: string, accountId?: string) => {
        return {
          provider: 'antigravity',
          user_identifier: 'user@example.com',
          access_token: 'other_token',
          expires_at: Date.now() + 3600000,
          project_id: 'project-123'
        };
      },
      getAllOAuthCredentials: () => [{
        provider: 'antigravity',
        user_identifier: 'user@example.com'
      }]
    } as any;

    const otherDispatcher = new Dispatcher();
    otherDispatcher.setUsageStorage(nonClaudeStorage);

    const mockConfig = {
      providers: {
        'other-provider': {
          type: 'gemini',
          api_base_url: 'https://generativelanguage.googleapis.com',
          oauth_provider: 'antigravity',
          oauth_account_pool: ['user@example.com'],
          models: ['gemini-2.0-flash']
        }
      },
      models: {
        'gemini-flash': {
          targets: [
            { provider: 'other-provider', model: 'gemini-2.0-flash' }
          ]
        }
      },
      keys: {},
      adminKey: "secret"
    };

    setConfigForTesting(mockConfig as any);

    const request = {
      model: 'gemini-flash',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 1024,
      stream: false
    };

    await otherDispatcher.dispatch(request);

    // fetch should be called but without Claude Code system instruction
    const fetchCall = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    // Should not have the Claude Code system instruction
    if (requestBody.system) {
      if (Array.isArray(requestBody.system)) {
        expect(requestBody.system[0]?.text).not.toBe("You are Claude Code, Anthropic's official CLI for Claude.");
      }
    }
  });

  test("should include Claude Code headers with pass-through", async () => {
    const mockConfig = {
      providers: {
        'claude-code-provider': {
          type: 'messages',
          api_base_url: 'https://api.anthropic.com',
          oauth_provider: 'claude-code',
          oauth_account_pool: ['claude@example.com'],
          models: ['claude-sonnet-4-5-20250929']
        }
      },
      models: {
        'claude-sonnet-4': {
          targets: [
            { provider: 'claude-code-provider', model: 'claude-sonnet-4-5-20250929' }
          ]
        }
      },
      keys: {},
      adminKey: "secret"
    };

    setConfigForTesting(mockConfig as any);

    const request = {
      model: 'claude-sonnet-4',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 1024,
      stream: false,
      incomingApiType: 'messages',
      originalBody: {
        model: 'claude-sonnet-4',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
        ],
        max_tokens: 1024
      }
    };

    await dispatcher.dispatch(request);

    const fetchCall = fetchMock.mock.calls[0];
    const headers = fetchCall[1].headers;

    // Verify Claude Code specific headers
    expect(headers['Anthropic-Beta']).toContain('claude-code-20250219');
    expect(headers['Anthropic-Beta']).toContain('oauth-2025-04-20');
    expect(headers['User-Agent']).toBe('claude-cli/1.0.83 (external, cli)');
    expect(headers['X-App']).toBe('cli');
  });
});
