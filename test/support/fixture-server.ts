import * as mockttp from 'mockttp';
import * as path from 'path';
import { readdirSync } from 'fs';
import { type FixtureRecord, fixtureKey, bodyHash, normalizeRequestBody } from './fixture-types';

type FixtureMap = Map<string, FixtureRecord>;

/**
 * The Fixture Server loads NDJSON fixture files and registers mockttp rules
 * that replay them. It runs as Plexus's upstream during E2E tests.
 *
 * Matching is done on method + normalized URL path + request body hash.
 * SSE replay uses a ReadableStream to drip events back chunk by chunk,
 * exercising Plexus's streaming pass-through code.
 */
export class FixtureServer {
  private server: mockttp.Mockttp;
  private fixtures: FixtureMap = new Map();

  constructor() {
    this.server = mockttp.getLocal({
      https: {
        keyPath: path.join(import.meta.dir, '../fixtures/testCA.key'),
        certPath: path.join(import.meta.dir, '../fixtures/testCA.pem'),
      },
    });
  }

  /** Load all fixtures from a directory (recursively) */
  async loadFixtures(dir: string): Promise<void> {
    const files = readdirSync(dir, { recursive: true }) as string[];
    for (const file of files) {
      if (!file.endsWith('.ndjson')) continue;
      const fullPath = path.join(dir, file);
      const text = await Bun.file(fullPath).text();
      const lines = text.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const record: FixtureRecord = JSON.parse(line);
        const key = fixtureKey(record.request.method, record.request.url, record.request.body);
        this.fixtures.set(key, record);
      }
    }
    console.log(`Loaded ${this.fixtures.size} fixture(s)`);
  }

  async start(): Promise<string> {
    await this.server.start();

    await this.server.anyRequest().thenCallback(async (req) => {
      const body = await req.body.getText();
      const key = fixtureKey(req.method, req.url, body);
      const fixture = this.fixtures.get(key);

      if (!fixture) {
        console.error(
          `[FixtureServer] No fixture for: ${req.method} ${req.url}\n` +
            `  Body hash: ${bodyHash(normalizeRequestBody(body))}\n` +
            `  Body: ${body.slice(0, 200)}`
        );
        return {
          status: 500,
          body: JSON.stringify({ error: 'No fixture found for this request' }),
          headers: { 'content-type': 'application/json' },
        };
      }

      const isSSE = fixture.response.sseEvents !== undefined;

      if (isSSE) {
        return this.buildSSEResponse(fixture);
      } else {
        return {
          status: fixture.response.status,
          headers: fixture.response.headers,
          body: fixture.response.body ?? '',
        };
      }
    });

    return this.server.url;
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }

  private buildSSEResponse(fixture: FixtureRecord): mockttp.CallbackResponseResult {
    const events = fixture.response.sseEvents!;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    });

    return {
      status: fixture.response.status,
      headers: {
        ...fixture.response.headers,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body: stream,
    };
  }
}
