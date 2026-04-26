import * as mockttp from 'mockttp';
import * as path from 'path';
import { type FixtureRecord, normalizeHeaders, parseSSEEvents } from './fixture-types';

const FIXTURES_DIR = path.join(import.meta.dir, '../fixtures');

/**
 * Run mockttp as a transparent passthrough proxy between Plexus and
 * the real upstream APIs. After traffic flows through, captured exchanges
 * are serialized to an NDJSON fixture file.
 *
 * Only run when you need to refresh fixtures — when adding new test
 * scenarios, or when upstream API response shapes change. Hits real
 * APIs and incurs charges.
 */
export async function runRecorder(
  scenarioName: string,
  provider: string,
  /**
   * A function that drives traffic through Plexus.
   * Plexus should be configured to use `upstreamProxyUrl` as its upstream base URL.
   */
  driveTraffic: (upstreamProxyUrl: string) => Promise<void>
): Promise<void> {
  const server = mockttp.getLocal({
    https: {
      keyPath: path.join(import.meta.dir, '../fixtures/testCA.key'),
      certPath: path.join(import.meta.dir, '../fixtures/testCA.pem'),
    },
  });

  await server.start();

  // Auth headers (authorization, x-api-key) are stripped by normalizeHeaders
  // when recording fixtures, so the proxy can pass real keys through to
  // upstream APIs without them ever appearing in fixture files.
  const rule = await server.anyRequest().thenPassThrough();

  try {
    await driveTraffic(server.url);
  } finally {
    const seen = await rule.getSeenRequests();
    const records: FixtureRecord[] = [];

    for (const req of seen) {
      const response = req.response;
      if (!response) continue;

      const contentType = response.headers['content-type'] ?? '';
      const isSSE = contentType.includes('text/event-stream');

      let record: FixtureRecord;

      if (isSSE) {
        const rawBody = await response.body.getText();
        const sseEvents = parseSSEEvents(rawBody);

        record = {
          request: {
            method: req.method,
            url: req.url,
            headers: normalizeHeaders(req.headers),
            body: await req.body.getText(),
          },
          response: {
            status: response.statusCode,
            headers: normalizeHeaders(response.headers),
            sseEvents,
          },
        };
      } else {
        record = {
          request: {
            method: req.method,
            url: req.url,
            headers: normalizeHeaders(req.headers),
            body: await req.body.getText(),
          },
          response: {
            status: response.statusCode,
            headers: normalizeHeaders(response.headers),
            body: await response.body.getText(),
          },
        };
      }

      records.push(record);
    }

    const dir = path.join(FIXTURES_DIR, provider);
    await Bun.$`mkdir -p ${dir}`;
    const outPath = path.join(dir, `${scenarioName}.ndjson`);
    await Bun.write(outPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`Wrote ${records.length} fixture(s) to ${outPath}`);

    await server.stop();
  }
}
