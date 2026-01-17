import { describe, expect, test, beforeEach } from "bun:test";
import { CooldownManager } from "../cooldown-manager";
import { UsageStorageService } from "../usage-storage";

describe("CooldownManager - Per-Account Cooldowns", () => {
    let cooldownManager: CooldownManager;
    let mockStorage: UsageStorageService;

    beforeEach(() => {
        // Get singleton instance and clear state
        cooldownManager = CooldownManager.getInstance();
        cooldownManager['cooldowns'].clear();

        // Create mock storage (in-memory, no actual DB operations)
        mockStorage = {
            saveCooldown: () => {},
            getCooldowns: () => [],
            clearCooldown: () => {},
            clearAllCooldowns: () => {}
        } as any;

        cooldownManager.setStorage(mockStorage);
    });

    test("Tracks cooldowns separately for different accounts on same provider", () => {
        const provider = 'my-antigravity';

        // Mark two different accounts as failed
        cooldownManager.markProviderFailure(provider, 'user1@company.com', 30000);
        cooldownManager.markProviderFailure(provider, 'user2@company.com', 60000);

        // user1 should be unhealthy
        expect(cooldownManager.isProviderHealthy(provider, 'user1@company.com')).toBe(false);

        // user2 should also be unhealthy
        expect(cooldownManager.isProviderHealthy(provider, 'user2@company.com')).toBe(false);

        // user3 (never marked as failed) should be healthy
        expect(cooldownManager.isProviderHealthy(provider, 'user3@company.com')).toBe(true);
    });

    test("Composite key format is provider:accountId", () => {
        const provider = 'my-antigravity';
        const accountId = 'user1@company.com';

        cooldownManager.markProviderFailure(provider, accountId, 30000);

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(1);
        expect(cooldowns[0]?.provider).toBe(provider);
        expect(cooldowns[0]?.accountId).toBe(accountId);
    });

    test("Provider-level cooldown (no accountId) is tracked independently", () => {
        const provider = 'my-openai';

        // Mark provider as failed without specific account (API key-based provider)
        cooldownManager.markProviderFailure(provider, undefined, 30000);

        // Provider-level check should be unhealthy
        expect(cooldownManager.isProviderHealthy(provider, undefined)).toBe(false);

        // Account-specific checks are independent (per-account OAuth would have separate cooldowns)
        expect(cooldownManager.isProviderHealthy(provider, 'user1@company.com')).toBe(true);
        expect(cooldownManager.isProviderHealthy(provider, 'user2@company.com')).toBe(true);
    });

    test("Account-specific cooldown does not affect other accounts", () => {
        const provider = 'my-antigravity';

        cooldownManager.markProviderFailure(provider, 'user1@company.com', 30000);

        // user1 is unhealthy
        expect(cooldownManager.isProviderHealthy(provider, 'user1@company.com')).toBe(false);

        // user2 remains healthy
        expect(cooldownManager.isProviderHealthy(provider, 'user2@company.com')).toBe(true);
    });

    test("Cooldown expires after specified duration", () => {
        const provider = 'my-antigravity';
        const accountId = 'user1@company.com';
        const shortDuration = 100; // 100ms

        cooldownManager.markProviderFailure(provider, accountId, shortDuration);

        // Immediately unhealthy
        expect(cooldownManager.isProviderHealthy(provider, accountId)).toBe(false);

        // Wait for cooldown to expire
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                // Should be healthy again
                expect(cooldownManager.isProviderHealthy(provider, accountId)).toBe(true);
                resolve();
            }, shortDuration + 50); // Add buffer
        });
    });

    test("Custom cooldown duration is used when provided", () => {
        const provider = 'my-antigravity';
        const accountId = 'user1@company.com';
        const customDuration = 45000; // 45 seconds

        cooldownManager.markProviderFailure(provider, accountId, customDuration);

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(1);

        // Check that timeRemainingMs is close to customDuration (within 100ms margin)
        const timeRemaining = cooldowns[0]?.timeRemainingMs;
        expect(timeRemaining).toBeGreaterThan(customDuration - 100);
        expect(timeRemaining).toBeLessThanOrEqual(customDuration);
    });

    test("Default cooldown duration is used when not provided", () => {
        const provider = 'my-antigravity';
        const accountId = 'user1@company.com';
        const defaultDuration = 10 * 60 * 1000; // 10 minutes

        cooldownManager.markProviderFailure(provider, accountId); // No duration specified

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(1);

        // Check that timeRemainingMs is close to default duration
        const timeRemaining = cooldowns[0]?.timeRemainingMs;
        expect(timeRemaining).toBeGreaterThan(defaultDuration - 1000);
        expect(timeRemaining).toBeLessThanOrEqual(defaultDuration);
    });

    test("getCooldowns returns all cooldowns with account info", () => {
        cooldownManager.markProviderFailure('provider1', 'user1@example.com', 30000);
        cooldownManager.markProviderFailure('provider1', 'user2@example.com', 45000);
        cooldownManager.markProviderFailure('provider2', 'user3@example.com', 60000);

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(3);

        // Check structure
        expect(cooldowns[0]).toHaveProperty('provider');
        expect(cooldowns[0]).toHaveProperty('accountId');
        expect(cooldowns[0]).toHaveProperty('expiry');
        expect(cooldowns[0]).toHaveProperty('timeRemainingMs');

        // Verify accounts are tracked
        const accountIds = cooldowns.map(cd => cd.accountId);
        expect(accountIds).toContain('user1@example.com');
        expect(accountIds).toContain('user2@example.com');
        expect(accountIds).toContain('user3@example.com');
    });

    test("Clearing cooldown for specific account does not affect others", () => {
        const provider = 'my-antigravity';

        cooldownManager.markProviderFailure(provider, 'user1@company.com', 60000);
        cooldownManager.markProviderFailure(provider, 'user2@company.com', 60000);

        // Both unhealthy
        expect(cooldownManager.isProviderHealthy(provider, 'user1@company.com')).toBe(false);
        expect(cooldownManager.isProviderHealthy(provider, 'user2@company.com')).toBe(false);

        // Clear cooldown for user1
        cooldownManager.clearCooldown(provider, 'user1@company.com');

        // user1 now healthy
        expect(cooldownManager.isProviderHealthy(provider, 'user1@company.com')).toBe(true);

        // user2 still unhealthy
        expect(cooldownManager.isProviderHealthy(provider, 'user2@company.com')).toBe(false);
    });

    test("Multiple providers can have same account identifiers independently", () => {
        const accountId = 'user@example.com';

        cooldownManager.markProviderFailure('provider-a', accountId, 30000);
        cooldownManager.markProviderFailure('provider-b', accountId, 60000);

        // Same account on provider-a is unhealthy
        expect(cooldownManager.isProviderHealthy('provider-a', accountId)).toBe(false);

        // Same account on provider-b is also unhealthy
        expect(cooldownManager.isProviderHealthy('provider-b', accountId)).toBe(false);

        // Clear cooldown only for provider-a
        cooldownManager.clearCooldown('provider-a', accountId);

        // provider-a:account is now healthy
        expect(cooldownManager.isProviderHealthy('provider-a', accountId)).toBe(true);

        // provider-b:account still unhealthy
        expect(cooldownManager.isProviderHealthy('provider-b', accountId)).toBe(false);
    });
});
