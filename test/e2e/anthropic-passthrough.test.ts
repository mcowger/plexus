import { describe, it, beforeAll, afterAll, expect } from 'bun:test';
import { FixtureServer } from '../support/fixture-server';
import {
  startPlexus,
  stopPlexus,
  configureModelAlias,
  getAdminKey,
} from '../support/plexus-harness';
import * as path from 'path';

describe('Anthropic passthrough', () => {
  let fixtureServer: FixtureServer;
  let plexusUrl: string;
  const adminKey = getAdminKey();

  beforeAll(async () => {
    // Start fixture server with all anthropic fixtures
    fixtureServer = new FixtureServer();
    await fixtureServer.loadFixtures(path.join(import.meta.dir, '../fixtures/anthropic'));
    const upstreamUrl = await fixtureServer.start();

    // Start Plexus with the fixture server as its Anthropic upstream
    plexusUrl = await startPlexus({
      anthropicBaseUrl: upstreamUrl,
      anthropicApiKey: 'test-dummy-key',
    });

    // Configure model alias so Plexus knows how to route claude-sonnet-4-6
    await configureModelAlias(plexusUrl, adminKey, 'claude-sonnet-4-6', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  afterAll(async () => {
    await stopPlexus();
    await fixtureServer.stop();
  });

  it('translates an Anthropic messages request end-to-end', async () => {
    const response = await fetch(`${plexusUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-dummy-key',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Say hello.' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe('message');
    expect(body.content[0].type).toBe('text');
    expect(typeof body.content[0].text).toBe('string');
  });

  it('streams an Anthropic response correctly', async () => {
    const response = await fetch(`${plexusUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-dummy-key',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        stream: true,
        messages: [{ role: 'user', content: 'Say hello.' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events: string[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(decoder.decode(value));
    }

    const dataLines = events
      .join('')
      .split('\n')
      .filter((l) => l.startsWith('data: '));

    expect(dataLines.length).toBeGreaterThan(0);
    const firstEvent = JSON.parse(dataLines[0].replace('data: ', ''));
    expect(firstEvent.type).toBe('message_start');
  });
});
