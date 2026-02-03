import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { PassThrough } from 'stream';
import { UsageInspector } from '../inspectors/usage-logging';
import { UsageStorageService } from '../usage-storage';
import { DebugManager } from '../debug-manager';
import type { UsageRecord } from '../../types/usage';

describe('UsageInspector', () => {
    let mockStorage: any;
    let mockPricing: any;

    beforeEach(() => {
        mockStorage = {
            saveRequest: mock(() => Promise.resolve()),
            updatePerformanceMetrics: mock(() => Promise.resolve())
        };
        mockPricing = {
            inputCostPerToken: 0.00001,
            outputCostPerToken: 0.00003
        };
    });

    afterEach(() => {
        const dm = DebugManager.getInstance();
        dm.setEnabled(false);
    });

    describe('extractUsageFromReconstructed', () => {
        it('should capture cached_tokens from OpenAI usage response with top-level cached_tokens', async () => {
            const requestId = 'test-request-with-cache-toplevel';
            const startTime = Date.now() - 100;

            const inspector = new UsageInspector(
                requestId,
                mockStorage,
                { requestId } as Partial<UsageRecord>,
                mockPricing,
                undefined,
                startTime,
                false,
                'chat'
            );

            const debugManager = DebugManager.getInstance();
            debugManager.setEnabled(true);
            debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

            debugManager.addReconstructedRawResponse(requestId, {
                id: 'chatcmpl-abc123',
                object: 'chat.completion',
                created: Date.now(),
                model: 'gpt-4o',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Hello!' },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    cached_tokens: 25
                }
            });

            const mockStream = new PassThrough();

            let capturedRecord: UsageRecord | null = null;
            spyOn(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
                capturedRecord = record;
                return Promise.resolve();
            });

            mockStream.pipe(inspector);
            mockStream.end();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedRecord).not.toBeNull();
            expect(capturedRecord!.tokensCached).toBe(25);
        });

        it('should capture cached_tokens from OpenAI prompt_tokens_details', async () => {
            const requestId = 'test-request-cache-details';
            const startTime = Date.now() - 100;

            const inspector = new UsageInspector(
                requestId,
                mockStorage,
                { requestId } as Partial<UsageRecord>,
                mockPricing,
                undefined,
                startTime,
                false,
                'chat'
            );

            const debugManager = DebugManager.getInstance();
            debugManager.setEnabled(true);
            debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

            debugManager.addReconstructedRawResponse(requestId, {
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    prompt_tokens_details: {
                        cached_tokens: 30
                    }
                }
            });

            const mockStream = new PassThrough();

            let capturedRecord: UsageRecord | null = null;
            spyOn(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
                capturedRecord = record;
                return Promise.resolve();
            });

            mockStream.pipe(inspector);
            mockStream.end();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedRecord).not.toBeNull();
            expect(capturedRecord!.tokensCached).toBe(30);
        });

        it('should prefer prompt_tokens_details.cached_tokens when both are present', async () => {
            const requestId = 'test-request-cache-both';
            const startTime = Date.now() - 100;

            const inspector = new UsageInspector(
                requestId,
                mockStorage,
                { requestId } as Partial<UsageRecord>,
                mockPricing,
                undefined,
                startTime,
                false,
                'chat'
            );

            const debugManager = DebugManager.getInstance();
            debugManager.setEnabled(true);
            debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

            debugManager.addReconstructedRawResponse(requestId, {
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    cached_tokens: 20,
                    prompt_tokens_details: {
                        cached_tokens: 35
                    }
                }
            });

            const mockStream = new PassThrough();

            let capturedRecord: UsageRecord | null = null;
            spyOn(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
                capturedRecord = record;
                return Promise.resolve();
            });

            mockStream.pipe(inspector);
            mockStream.end();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedRecord).not.toBeNull();
            expect(capturedRecord!.tokensCached).toBe(35);
        });

        it('should handle Anthropic cache_read_input_tokens', async () => {
            const requestId = 'test-anthropic-cache';
            const startTime = Date.now() - 100;

            const inspector = new UsageInspector(
                requestId,
                mockStorage,
                { requestId } as Partial<UsageRecord>,
                mockPricing,
                undefined,
                startTime,
                false,
                'messages'
            );

            const debugManager = DebugManager.getInstance();
            debugManager.setEnabled(true);
            debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

            debugManager.addReconstructedRawResponse(requestId, {
                usage: {
                    input_tokens: 200,
                    output_tokens: 75,
                    cache_read_input_tokens: 150
                }
            });

            const mockStream = new PassThrough();

            let capturedRecord: UsageRecord | null = null;
            spyOn(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
                capturedRecord = record;
                return Promise.resolve();
            });

            mockStream.pipe(inspector);
            mockStream.end();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedRecord).not.toBeNull();
            expect(capturedRecord!.tokensCached).toBe(150);
        });

        it('should handle Gemini cachedContentTokenCount', async () => {
            const requestId = 'test-gemini-cache';
            const startTime = Date.now() - 100;

            const inspector = new UsageInspector(
                requestId,
                mockStorage,
                { requestId } as Partial<UsageRecord>,
                mockPricing,
                undefined,
                startTime,
                false,
                'gemini'
            );

            const debugManager = DebugManager.getInstance();
            debugManager.setEnabled(true);
            debugManager.startLog(requestId, { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] });

            debugManager.addReconstructedRawResponse(requestId, {
                usageMetadata: {
                    promptTokenCount: 50,
                    candidatesTokenCount: 25,
                    cachedContentTokenCount: 40
                }
            });

            const mockStream = new PassThrough();

            let capturedRecord: UsageRecord | null = null;
            spyOn(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
                capturedRecord = record;
                return Promise.resolve();
            });

            mockStream.pipe(inspector);
            mockStream.end();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedRecord).not.toBeNull();
            expect(capturedRecord!.tokensCached).toBe(40);
        });

        it('should extract reasoning tokens from OpenAI completion_tokens_details', async () => {
            const requestId = 'test-reasoning-tokens';
            const startTime = Date.now() - 100;

            const inspector = new UsageInspector(
                requestId,
                mockStorage,
                { requestId } as Partial<UsageRecord>,
                mockPricing,
                undefined,
                startTime,
                false,
                'chat'
            );

            const debugManager = DebugManager.getInstance();
            debugManager.setEnabled(true);
            debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Think carefully' }] });

            debugManager.addReconstructedRawResponse(requestId, {
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    completion_tokens_details: {
                        reasoning_tokens: 25
                    }
                }
            });

            const mockStream = new PassThrough();

            let capturedRecord: UsageRecord | null = null;
            spyOn(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
                capturedRecord = record;
                return Promise.resolve();
            });

            mockStream.pipe(inspector);
            mockStream.end();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedRecord).not.toBeNull();
            expect(capturedRecord!.tokensReasoning).toBe(25);
        });
    });
});