import { describe, mock, beforeEach, afterEach, spyOn, beforeAll, afterAll } from "bun:test";
import { Dispatcher } from "../services/dispatcher";
import { UsageStorageService } from "../services/usage-storage";
import { setConfigForTesting, loadConfig } from "../config";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEMP_CONFIG_PATH = join(tmpdir(), `plexus-test-stream-${Date.now()}.yaml`);
const TEST_CONFIG = {
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

// Write temp config file
writeFileSync(TEMP_CONFIG_PATH, JSON.stringify(TEST_CONFIG)); // Simple JSON is valid YAML mostly, or close enough for parser if it handles JSON.
// Wait, validateConfig uses yaml.parse. JSON is valid YAML.

describe("Streaming Usage Integration", () => {
    let dispatchSpy: any;
    let saveRequestSpy: any;
    let server: any;

    beforeAll(async () => {
        process.env.PLEXUS_DB_URL = ':memory:';
        process.env.CONFIG_FILE = TEMP_CONFIG_PATH;
        
        // Initialize config
        await loadConfig(TEMP_CONFIG_PATH);
        setConfigForTesting(TEST_CONFIG as any);

        // Load the module
        const module = await import("../index");
        server = module.default;
    });

    afterAll(() => {
        try {
            unlinkSync(TEMP_CONFIG_PATH);
        } catch (e) {
            // ignore
        }
        delete process.env.CONFIG_FILE;
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
