import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import winston from 'winston';
import { logEmitter, StreamTransport } from '../log-base';

describe('Logger Utility', () => {
    let testLogger: winston.Logger;

    beforeEach(() => {
        // Create a fresh logger instance for each test to avoid isolation issues
        testLogger = winston.createLogger({
            level: 'info',
            silent: true, // Suppress console output during tests
            transports: [new StreamTransport()]
        });
    });

    afterEach(() => {
        // Close the logger and clean up listeners to prevent issues between tests
        testLogger.close();
        logEmitter.removeAllListeners();
    });

    it('should emit log events via logEmitter when logger logs', async () => {
        const message = 'Test log message';
        const level = 'info';
        
        // Create a promise that resolves when the event is emitted
        const logPromise = new Promise<any>((resolve) => {
            logEmitter.once('log', (info) => {
                resolve(info);
            });
        });

        // Trigger log
        testLogger.info(message);

        // Await the event
        const logInfo = await logPromise;

        expect(logInfo).toBeDefined();
        expect(logInfo.message).toBe(message);
        expect(logInfo.level).toBe(level);
    });

    it('should include metadata in emitted log events', async () => {
        const message = 'Metadata test';
        const metadata = { userId: 123, action: 'login' };
        
        const logPromise = new Promise<any>((resolve) => {
            logEmitter.once('log', (info) => {
                resolve(info);
            });
        });

        testLogger.info(message, metadata);

        const logInfo = await logPromise;

        expect(logInfo.message).toBe(message);
        expect(logInfo.userId).toBe(123);
        expect(logInfo.action).toBe('login');
    });
});