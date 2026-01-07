import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { setConfigForTesting } from "../../config";
import { CooldownManager } from "../cooldown-manager";
import { UsageStorageService } from "../usage-storage";

// Mock fetch
const fetchMock = mock(async (url: string, options: any) => {
    return new Response(JSON.stringify({
        id: "test-response",
        model: "gemini-2.0-flash-thinking-exp",
        choices: [{ message: { role: "assistant", content: "Test response" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
});
global.fetch = fetchMock;

describe("Dispatcher OAuth Account Selection - Round-Robin", () => {
    let dispatcher: Dispatcher;
    let mockStorage: UsageStorageService;

    beforeEach(() => {
        fetchMock.mockClear();

        // Reset cooldown manager state
        const cooldownManager = CooldownManager.getInstance();
        cooldownManager['cooldowns'].clear();

        // Create mock storage
        mockStorage = {
            getOAuthCredential: (provider: string, accountId?: string) => {
                const credentials: Record<string, any> = {
                    'user1@company.com': {
                        provider: 'antigravity',
                        user_identifier: 'user1@company.com',
                        access_token: 'token1',
                        refresh_token: 'refresh1',
                        token_type: 'Bearer',
                        expires_at: Date.now() + 3600000,
                        project_id: 'project1'
                    },
                    'user2@company.com': {
                        provider: 'antigravity',
                        user_identifier: 'user2@company.com',
                        access_token: 'token2',
                        refresh_token: 'refresh2',
                        token_type: 'Bearer',
                        expires_at: Date.now() + 3600000,
                        project_id: 'project2'
                    },
                    'user3@company.com': {
                        provider: 'antigravity',
                        user_identifier: 'user3@company.com',
                        access_token: 'token3',
                        refresh_token: 'refresh3',
                        token_type: 'Bearer',
                        expires_at: Date.now() + 3600000,
                        project_id: 'project3'
                    }
                };
                return accountId ? credentials[accountId] : credentials['user1@company.com'];
            }
        } as any;

        dispatcher = new Dispatcher();
        dispatcher.setUsageStorage(mockStorage);
    });

    test("Round-robin selects accounts in sequential order", async () => {
        const mockConfig = {
            providers: {
                'my-antigravity': {
                    type: 'gemini',
                    api_base_url: 'https://generativelanguage.googleapis.com',
                    oauth_provider: 'antigravity',
                    oauth_account_pool: ['user1@company.com', 'user2@company.com', 'user3@company.com'],
                    models: ['gemini-2.0-flash-thinking-exp']
                }
            },
            models: {
                'gemini-thinking': {
                    targets: [
                        { provider: 'my-antigravity', model: 'gemini-2.0-flash-thinking-exp' }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };
        setConfigForTesting(mockConfig as any);

        const request = {
            model: 'gemini-thinking',
            messages: [{ role: 'user' as const, content: 'Test' }],
            incomingApiType: 'gemini',
            stream: false
        };

        // First request should use user2 (index 0 + 1 = 1)
        await dispatcher.dispatch(request);
        let lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        let authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token2');

        // Second request should use user3 (index 1 + 1 = 2)
        await dispatcher.dispatch(request);
        lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token3');

        // Third request should wrap around to user1 (index 2 + 1 = 3 % 3 = 0)
        await dispatcher.dispatch(request);
        lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token1');
    });

    test("Round-robin skips accounts on cooldown", async () => {
        const mockConfig = {
            providers: {
                'my-antigravity': {
                    type: 'gemini',
                    api_base_url: 'https://generativelanguage.googleapis.com',
                    oauth_provider: 'antigravity',
                    oauth_account_pool: ['user1@company.com', 'user2@company.com', 'user3@company.com'],
                    models: ['gemini-2.0-flash-thinking-exp']
                }
            },
            models: {
                'gemini-thinking': {
                    targets: [
                        { provider: 'my-antigravity', model: 'gemini-2.0-flash-thinking-exp' }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };
        setConfigForTesting(mockConfig as any);

        const request = {
            model: 'gemini-thinking',
            messages: [{ role: 'user' as const, content: 'Test' }],
            incomingApiType: 'gemini',
            stream: false
        };

        // Put user2 on cooldown
        const cooldownManager = CooldownManager.getInstance();
        cooldownManager.markProviderFailure('my-antigravity', 'user2@company.com', 60000);

        // First request should use user3 (skipping user2 who is on cooldown)
        await dispatcher.dispatch(request);
        let lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        let authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token3');

        // Second request should use user1 (wrapping around, still skipping user2)
        await dispatcher.dispatch(request);
        lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token1');
    });

    test("Throws error when all accounts are on cooldown", async () => {
        const mockConfig = {
            providers: {
                'my-antigravity': {
                    type: 'gemini',
                    api_base_url: 'https://generativelanguage.googleapis.com',
                    oauth_provider: 'antigravity',
                    oauth_account_pool: ['user1@company.com', 'user2@company.com'],
                    models: ['gemini-2.0-flash-thinking-exp']
                }
            },
            models: {
                'gemini-thinking': {
                    targets: [
                        { provider: 'my-antigravity', model: 'gemini-2.0-flash-thinking-exp' }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };
        setConfigForTesting(mockConfig as any);

        const request = {
            model: 'gemini-thinking',
            messages: [{ role: 'user' as const, content: 'Test' }],
            incomingApiType: 'gemini',
            stream: false
        };

        // Put all accounts on cooldown
        const cooldownManager = CooldownManager.getInstance();
        cooldownManager.markProviderFailure('my-antigravity', 'user1@company.com', 30000);
        cooldownManager.markProviderFailure('my-antigravity', 'user2@company.com', 45000);

        // Should throw error with cooldown info
        try {
            await dispatcher.dispatch(request);
            expect(false).toBe(true); // Should not reach here
        } catch (error: any) {
            expect(error.message).toContain('All OAuth accounts');
            expect(error.message).toContain('are on cooldown');
            expect(error.message).toContain('user1@company.com');
            expect(error.message).toContain('user2@company.com');
        }
    });

    test("Single account pool works without rotation", async () => {
        const mockConfig = {
            providers: {
                'my-antigravity': {
                    type: 'gemini',
                    api_base_url: 'https://generativelanguage.googleapis.com',
                    oauth_provider: 'antigravity',
                    oauth_account_pool: ['user1@company.com'],
                    models: ['gemini-2.0-flash-thinking-exp']
                }
            },
            models: {
                'gemini-thinking': {
                    targets: [
                        { provider: 'my-antigravity', model: 'gemini-2.0-flash-thinking-exp' }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };
        setConfigForTesting(mockConfig as any);

        const request = {
            model: 'gemini-thinking',
            messages: [{ role: 'user' as const, content: 'Test' }],
            incomingApiType: 'gemini',
            stream: false
        };

        // All requests should use the same account
        await dispatcher.dispatch(request);
        let lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        let authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token1');

        await dispatcher.dispatch(request);
        lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        authHeader = (lastCall[1] as any).headers['Authorization'];
        expect(authHeader).toBe('Bearer token1');
    });

    test("403 errors trigger 10-minute cooldown on account", async () => {
        const mockConfig = {
            providers: {
                'my-antigravity': {
                    type: 'gemini',
                    api_base_url: 'https://generativelanguage.googleapis.com',
                    oauth_provider: 'antigravity',
                    oauth_account_pool: ['user1@company.com', 'user2@company.com'],
                    models: ['gemini-2.0-flash-thinking-exp']
                }
            },
            models: {
                'gemini-thinking': {
                    targets: [
                        { provider: 'my-antigravity', model: 'gemini-2.0-flash-thinking-exp' }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };
        setConfigForTesting(mockConfig as any);

        // Mock a 403 error response
        const errorFetchMock = mock(async () => {
            return new Response(JSON.stringify({
                error: {
                    code: 403,
                    message: "Permission denied on resource project.",
                    status: "PERMISSION_DENIED"
                }
            }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
            });
        });
        global.fetch = errorFetchMock;

        const request = {
            model: 'gemini-thinking',
            messages: [{ role: 'user' as const, content: 'Test' }],
            incomingApiType: 'gemini',
            stream: false
        };

        const cooldownManager = CooldownManager.getInstance();

        // First request should fail with 403 and put user2 on cooldown
        try {
            await dispatcher.dispatch(request);
            expect(false).toBe(true); // Should not reach here
        } catch (error: any) {
            expect(error.message).toContain('403');
        }

        // Verify user2 is on cooldown (10 minutes default)
        expect(cooldownManager.isProviderHealthy('my-antigravity', 'user2@company.com')).toBe(false);

        // Verify cooldown duration is approximately 10 minutes
        const cooldowns = cooldownManager.getCooldowns();
        const user2Cooldown = cooldowns.find(cd => cd.accountId === 'user2@company.com');
        expect(user2Cooldown).toBeDefined();

        const tenMinutesMs = 10 * 60 * 1000;
        expect(user2Cooldown!.timeRemainingMs).toBeGreaterThan(tenMinutesMs - 1000); // Within 1 second
        expect(user2Cooldown!.timeRemainingMs).toBeLessThanOrEqual(tenMinutesMs);
    });
});
