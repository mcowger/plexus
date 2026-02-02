import { describe, expect, test, beforeEach } from "bun:test";
import { CooldownManager } from "../cooldown-manager";
import { getDatabase } from "../../db/client";
import * as schema from "../../../drizzle/schema";

describe("CooldownManager - Per-Account Cooldowns", () => {
    let cooldownManager: CooldownManager;

    beforeEach(async () => {
        // Get singleton instance and clear in-memory state
        cooldownManager = CooldownManager.getInstance();
        cooldownManager['cooldowns'].clear();

        // Clear all cooldowns from the database
        const db = getDatabase();
        await db.delete(schema.providerCooldowns);
        
        // Reload cooldowns (will be empty now)
        await cooldownManager.loadFromStorage();
    });

    test("Tracks cooldowns separately for different accounts on same provider+model", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';

        // Mark two different accounts as failed
        await cooldownManager.markProviderFailure(provider, model, 'user1@company.com', 30000);
        await cooldownManager.markProviderFailure(provider, model, 'user2@company.com', 60000);

        // user1 should be unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user1@company.com')).toBe(false);

        // user2 should also be unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user2@company.com')).toBe(false);

        // user3 (never marked as failed) should be healthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user3@company.com')).toBe(true);
    });

    test("Composite key format is provider:model:accountId", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';
        const accountId = 'user1@company.com';

        await cooldownManager.markProviderFailure(provider, model, accountId, 30000);

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(1);
        expect(cooldowns[0]?.provider).toBe(provider);
        expect(cooldowns[0]?.model).toBe(model);
        expect(cooldowns[0]?.accountId).toBe(accountId);
    });

    test("Provider+model-level cooldown (no accountId) is tracked independently", async () => {
        const provider = 'my-openai';
        const model = 'gpt-3.5-turbo';

        // Mark provider+model as failed without specific account (API key-based provider)
        await cooldownManager.markProviderFailure(provider, model, undefined, 30000);

        // Provider+model-level check should be unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, undefined)).toBe(false);

        // Account-specific checks are independent (per-account OAuth would have separate cooldowns)
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user1@company.com')).toBe(true);
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user2@company.com')).toBe(true);
    });

    test("Account-specific cooldown does not affect other accounts", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';

        await cooldownManager.markProviderFailure(provider, model, 'user1@company.com', 30000);

        // user1 is unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user1@company.com')).toBe(false);

        // user2 remains healthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user2@company.com')).toBe(true);
    });

    test("Different models on same provider can have independent cooldowns", async () => {
        const provider = 'my-openai';

        // Mark gpt-4 as failed
        await cooldownManager.markProviderFailure(provider, 'gpt-4', undefined, 30000);

        // gpt-4 should be unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, 'gpt-4', undefined)).toBe(false);

        // gpt-3.5-turbo should still be healthy
        expect(await cooldownManager.isProviderHealthy(provider, 'gpt-3.5-turbo', undefined)).toBe(true);
    });

    test("Cooldown expires after specified duration", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';
        const accountId = 'user1@company.com';
        const shortDuration = 100; // 100ms

        await cooldownManager.markProviderFailure(provider, model, accountId, shortDuration);

        // Immediately unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, accountId)).toBe(false);

        // Wait for cooldown to expire
        return new Promise<void>((resolve) => {
            setTimeout(async () => {
                // Should be healthy again
                expect(await cooldownManager.isProviderHealthy(provider, model, accountId)).toBe(true);
                resolve();
            }, shortDuration + 50); // Add buffer
        });
    });

    test("Custom cooldown duration is used when provided", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';
        const accountId = 'user1@company.com';
        const customDuration = 45000; // 45 seconds

        await cooldownManager.markProviderFailure(provider, model, accountId, customDuration);

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(1);

        // Check that timeRemainingMs is close to customDuration (within 100ms margin)
        const timeRemaining = cooldowns[0]?.timeRemainingMs;
        expect(timeRemaining).toBeGreaterThan(customDuration - 100);
        expect(timeRemaining).toBeLessThanOrEqual(customDuration);
    });

    test("Default cooldown duration is used when not provided", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';
        const accountId = 'user1@company.com';
        const defaultDuration = 10 * 60 * 1000; // 10 minutes

        await cooldownManager.markProviderFailure(provider, model, accountId); // No duration specified

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(1);

        // Check that timeRemainingMs is close to default duration
        const timeRemaining = cooldowns[0]?.timeRemainingMs;
        expect(timeRemaining).toBeGreaterThan(defaultDuration - 1000);
        expect(timeRemaining).toBeLessThanOrEqual(defaultDuration);
    });

    test("getCooldowns returns all cooldowns with model and account info", async () => {
        await cooldownManager.markProviderFailure('provider1', 'model1', 'user1@example.com', 30000);
        await cooldownManager.markProviderFailure('provider1', 'model2', 'user2@example.com', 45000);
        await cooldownManager.markProviderFailure('provider2', 'model1', 'user3@example.com', 60000);

        const cooldowns = cooldownManager.getCooldowns();
        expect(cooldowns.length).toBe(3);

        // Check structure
        expect(cooldowns[0]).toHaveProperty('provider');
        expect(cooldowns[0]).toHaveProperty('model');
        expect(cooldowns[0]).toHaveProperty('accountId');
        expect(cooldowns[0]).toHaveProperty('expiry');
        expect(cooldowns[0]).toHaveProperty('timeRemainingMs');

        // Verify accounts are tracked
        const accountIds = cooldowns.map(cd => cd.accountId);
        expect(accountIds).toContain('user1@example.com');
        expect(accountIds).toContain('user2@example.com');
        expect(accountIds).toContain('user3@example.com');
    });

    test("Clearing cooldown for specific account+model does not affect others", async () => {
        const provider = 'my-antigravity';
        const model = 'gpt-4';

        await cooldownManager.markProviderFailure(provider, model, 'user1@company.com', 60000);
        await cooldownManager.markProviderFailure(provider, model, 'user2@company.com', 60000);

        // Both unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user1@company.com')).toBe(false);
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user2@company.com')).toBe(false);

        // Clear cooldown for user1
        await cooldownManager.clearCooldown(provider, model, 'user1@company.com');

        // user1 now healthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user1@company.com')).toBe(true);

        // user2 still unhealthy
        expect(await cooldownManager.isProviderHealthy(provider, model, 'user2@company.com')).toBe(false);
    });

    test("Multiple providers can have same model+account identifiers independently", async () => {
        const model = 'gpt-4';
        const accountId = 'user@example.com';

        await cooldownManager.markProviderFailure('provider-a', model, accountId, 30000);
        await cooldownManager.markProviderFailure('provider-b', model, accountId, 60000);

        // Same model+account on provider-a is unhealthy
        expect(await cooldownManager.isProviderHealthy('provider-a', model, accountId)).toBe(false);

        // Same model+account on provider-b is also unhealthy
        expect(await cooldownManager.isProviderHealthy('provider-b', model, accountId)).toBe(false);

        // Clear cooldown only for provider-a+model+account
        await cooldownManager.clearCooldown('provider-a', model, accountId);

        // provider-a:model:account is now healthy
        expect(await cooldownManager.isProviderHealthy('provider-a', model, accountId)).toBe(true);

        // provider-b:model:account still unhealthy
        expect(await cooldownManager.isProviderHealthy('provider-b', model, accountId)).toBe(false);
    });
});
