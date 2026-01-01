import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { UnifiedChatRequest } from "../../types/unified";
import fs from "fs";
import path from "path";
import { Polly } from "@pollyjs/core";
import NodeHttpAdapter from "@pollyjs/adapter-fetch";
import FSPersister from "@pollyjs/persister-fs";

// Register Polly adapters
Polly.register(NodeHttpAdapter);
Polly.register(FSPersister);

// Mock Logger
const { mock } = require("bun:test");
mock.module("../../utils/logger", () => ({
    logger: {
        info: mock(),
        error: mock(),
        warn: mock(),
        debug: mock(),
        silly: mock(),
    }
}));

// Constants for scrubbing
const SCRUBBED_KEY = "scrubbed_key";
const SCRUBBED_MODEL = "scrubbed_model";
const SCRUBBED_BASE_URL = "https://api.upstream.mock/openai/v1";

// Configuration with Env Override
const mockConfig = {
    providers: {
        "sample": {
            type: "OpenAI",
            display_name: "SAMPLE",
            // Must match the path structure of the recorded URL (minus the host)
            api_base_url: process.env.PLEXUS_TEST_BASE_URL || SCRUBBED_BASE_URL,
            api_key: process.env.PLEXUS_TEST_API_KEY || SCRUBBED_KEY,
            models: [process.env.PLEXUS_TEST_MODEL || SCRUBBED_MODEL]
        },
        "sample-anthropic": {
            type: "Anthropic",
            display_name: "SAMPLE-ANTHROPIC",
            api_base_url: process.env.PLEXUS_TEST_ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
            api_key: process.env.PLEXUS_TEST_ANTHROPIC_API_KEY || SCRUBBED_KEY,
            models: ["claude-haiku-4-5"]
        }
    },
    models: {
        "minimax-m2.1": {
            targets: [{
                provider: "sample",
                model: process.env.PLEXUS_TEST_MODEL || SCRUBBED_MODEL
            }]
        },
        "claude-haiku": {
            targets: [{
                provider: "sample-anthropic",
                model: "claude-haiku-4-5"
            }]
        }
    }
};

mock.module("../../config", () => ({
    getConfig: () => mockConfig,
    loadConfig: () => mockConfig
}));

const CASES_DIR = path.join(import.meta.dir, "cases");
const CASSETTES_DIR = path.join(import.meta.dir, "__cassettes__");

function getFiles(dir: string, baseDir: string = dir): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
        .filter(file => !file.isDirectory() && file.name.endsWith(".json"))
        .map(file => path.relative(baseDir, path.join(dir, file.name)));
    const folders = entries.filter(file => file.isDirectory());
    for (const folder of folders) {
        files.push(...getFiles(path.join(dir, folder.name), baseDir));
    }
    return files;
}

describe("E2E Tests", () => {
    let dispatcher: Dispatcher;
    let polly: Polly;

    const shouldRecord = process.env.RECORD === "1" || 
                        process.argv.includes("--update-snapshots") || 
                        process.argv.includes("-u");

    beforeEach(async () => {
        dispatcher = new Dispatcher();
    });

    afterEach(async () => {
        if (polly) {
            await polly.stop();
        }
    });

    const testFiles = getFiles(CASES_DIR);

    for (const file of testFiles) {
        test(`Case: ${file}`, async () => {
            const commandPath = path.join(CASES_DIR, file);
            const clientRequest: UnifiedChatRequest = JSON.parse(fs.readFileSync(commandPath, "utf8"));
            
            // Route to different models/providers based on directory
            if (file.startsWith('messages/')) {
                clientRequest.model = "claude-haiku";
            } else {
                clientRequest.model = "minimax-m2.1";
            }

            // Initialize Polly for this test case
            // Use 'file' (including subpath) as recording name for clear mapping
            polly = new Polly(file, {
                adapters: ["fetch"],
                persister: "fs",
                persisterOptions: {
                    fs: {
                        recordingsDir: CASSETTES_DIR
                    }
                },
                mode: shouldRecord ? "record" : "replay",
                matchRequestsBy: {
                    headers: false,
                    body: false, // Rely on order/method as scrubbing changes the body/url between record/replay
                    url: false,
                    order: true,
                    method: true
                },
                recordIfMissing: false
            });
            
            // Scrub sensitive data from cassettes before they are saved
            polly.server.any().on('beforePersist', (_req, recording) => {
                const realModel = process.env.PLEXUS_TEST_MODEL || "hf:MiniMaxAI/MiniMax-M2.1";
                const anthropicModel = "claude-haiku-4-5";

                // 1. Scrub Headers
                recording.request.headers = recording.request.headers.map((h: any) => {
                    const name = h.name.toLowerCase();
                    if (['authorization', 'api-key', 'x-api-key'].includes(name)) {
                         h.value = name === 'x-api-key' ? SCRUBBED_KEY : `Bearer ${SCRUBBED_KEY}`;
                    }
                    return h;
                });
                
                // 2. Scrub URL Host
                const scrubHost = (url: string) => {
                    return url.replace(/https?:\/\/[^\/]+/, "https://api.upstream.mock");
                };
                recording.request.url = scrubHost(recording.request.url);

                // 3. Scrub Request Body (Model name)
                if (recording.request.postData && recording.request.postData.text) {
                    recording.request.postData.text = recording.request.postData.text
                        .split(realModel).join(SCRUBBED_MODEL)
                        .split(anthropicModel).join(SCRUBBED_MODEL);
                }

                // 4. Scrub Response Body (Model name)
                if (recording.response.content && recording.response.content.text) {
                    recording.response.content.text = recording.response.content.text
                        .split(realModel).join(SCRUBBED_MODEL)
                        .split(anthropicModel).join(SCRUBBED_MODEL);
                }

                // 5. Scrub Response Headers (Cookies)
                if (recording.response && recording.response.headers) {
                    recording.response.headers = recording.response.headers.filter((h: any) => {
                        return !['set-cookie'].includes(h.name.toLowerCase());
                    });
                    recording.response.cookies = []; 
                }
            });
            // Execute Request
            const response = await dispatcher.dispatch(clientRequest);

            // Basic verification of the response structure
            expect(response).toBeDefined();
            expect(response.model).toBeDefined();

            if (clientRequest.stream) {
                 expect(response.stream).toBeDefined();
                 // Consume stream to ensure interaction completes
                 const reader = response.stream.getReader();
                 while (true) {
                     const { done } = await reader.read();
                     if (done) break;
                 }
            } else {
                 expect(response.content).toBeDefined();
            }
        }, 20000); 
    }
});
