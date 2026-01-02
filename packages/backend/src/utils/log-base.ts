import Transport from 'winston-transport';
import { EventEmitter } from 'events';

// Event emitter for streaming logs
export const logEmitter = new EventEmitter();

// Custom transport to emit logs
export class StreamTransport extends Transport {
  override log(info: any, callback: () => void) {
    setImmediate(() => {
      logEmitter.emit('log', info);
    });
    callback();
  }
}
