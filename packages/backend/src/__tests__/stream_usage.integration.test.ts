import { describe, expect, test, mock, beforeEach, afterEach, spyOn, beforeAll } from "bun:test";
import { Dispatcher } from "../services/dispatcher";
import { UsageStorageService } from "../services/usage-storage";

// Mock Config
mock.module('../config', () => {
    const { z } = require('zod');
    // Reconstruct the config object directly here since we want to ensure getConfig returns it
    const testConfig = {
        providers: {
            openai: {
                type: 'chat',
                api_base_url: 'https://api.openai.com/v1',
                api_key: 'test-key',
                models: ['gpt-4', 'gpt-3.5-turbo']
            }
        },
        models: {
            'gpt-4': {
                targets: [{ provider: 'openai', model: 'gpt-4' }]
            }
        },
        keys: {
            'test-key': {
                secret: 'sk-test-key',
                comment: 'Test Key'
            }
        },
        adminKey: 'test-admin-key'
    };

    return {
        loadConfig: () => Promise.resolve(testConfig),
        getConfig: () => testConfig,
        getConfigPath: () => '/tmp/test-config.yaml',
        validateConfig: () => testConfig,
        setConfigForTesting: () => {}
    };
});

describe("Streaming Usage Integration", () => {
    let dispatchSpy: any;
    let saveRequestSpy: any;
    let server: any;

    beforeAll(async () => {
        process.env.PLEXUS_DB_URL = ':memory:';
        
        // Load the module
        const module = await import("../index");
        server = module.default;
    });

    beforeEach(() => {
        dispatchSpy = spyOn(Dispatcher.prototype, 'dispatch');
        saveRequestSpy = spyOn(UsageStorageService.prototype, 'saveRequest').mockImplementation(() => {});
    });

    afterEach(() => {
        dispatchSpy.mockRestore();
        saveRequestSpy.mockRestore();
    });

});
