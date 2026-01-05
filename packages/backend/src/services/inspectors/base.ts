import { PassThrough } from 'stream';

export abstract class BaseInspector {
    protected requestId: string;

    constructor(requestId: string) {
        this.requestId = requestId;
    }

    abstract createInspector(): PassThrough;
}
