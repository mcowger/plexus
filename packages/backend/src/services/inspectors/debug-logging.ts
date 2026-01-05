import { BaseInspector } from "./base";
import { logger } from 'src/utils/logger';
import { PassThrough } from 'stream';

export class DebugLoggingInspector extends BaseInspector {
    createInspector(): PassThrough {
        const inspector = new PassThrough();
        let bytes = 0;

        // Monitors data chunks as they fly past.
        inspector.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
        });

        // Final report when the stream finishes.
        inspector.on('end', () => {
            logger.info(`[Inspector:Logging] Request ${this.requestId} finished. Total bytes transferred: ${bytes}`);
        });

        return inspector;
    }
}