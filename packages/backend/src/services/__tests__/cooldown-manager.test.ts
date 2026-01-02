import { expect, test, describe } from "bun:test";
import { CooldownManager } from "../cooldown-manager";

describe("CooldownManager", () => {
    
    test("marks provider as unhealthy", () => {
        const manager = CooldownManager.getInstance();
        manager.markProviderFailure("bad-provider");
        expect(manager.isProviderHealthy("bad-provider")).toBe(false);
    });

    test("filters healthy targets", () => {
        const manager = CooldownManager.getInstance();
        manager.markProviderFailure("bad-provider-2");
        
        const targets = [
            { provider: "good-provider", model: "m1" },
            { provider: "bad-provider-2", model: "m2" }
        ];
        
        const filtered = manager.filterHealthyTargets(targets);
        expect(filtered).toHaveLength(1);
        expect(filtered[0]!.provider).toBe("good-provider");
    });

    test("provider recovers after short duration", async () => {
         process.env.PLEXUS_PROVIDER_COOLDOWN_MINUTES = "0.0001"; // 0.006 seconds approx
         const manager = CooldownManager.getInstance();
         manager.markProviderFailure("recovering-provider");
         expect(manager.isProviderHealthy("recovering-provider")).toBe(false);
         
         await new Promise(r => setTimeout(r, 50)); 
         
         expect(manager.isProviderHealthy("recovering-provider")).toBe(true);
         
         // Reset env
         delete process.env.PLEXUS_PROVIDER_COOLDOWN_MINUTES;
    });
});
