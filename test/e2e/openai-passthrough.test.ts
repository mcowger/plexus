import { describe, it, beforeAll, afterAll, expect } from 'bun:test';
import { FixtureServer } from '../support/fixture-server';
import {
  startPlexus,
  stopPlexus,
  configureModelAlias,
  getAdminKey,
} from '../support/plexus-harness';
import * as path from 'path';

describe('OpenAI passthrough', () => {
  let fixtureServer: FixtureServer;
  let plexusUrl: string;
  const adminKey = getAdminKey();

  beforeAll(async () => {
    // Start fixture server with all openai fixtures
    fixtureServer = new FixtureServer();
    await fixtureServer.loadFixtures(path.join(import.meta.dir, '../fixtures/openai'));
    const upstreamUrl = await fixtureServer.start();

    // Start Plexus with the fixture server as its OpenAI upstream
    plexusUrl = await startPlexus({
      openaiBaseUrl: upstreamUrl,
      openaiApiKey: 'test-dummy-key',
    });

    // Configure model alias so Plexus knows how to route gpt-4o
    await configureModelAlias(plexusUrl, adminKey, 'gpt-4o', {
      provider: 'openai',
      model: 'gpt-4o',
    });
  });

  afterAll(async () => {
    await stopPlexus();
    await fixtureServer.stop();
  });

  it('translates an OpenAI chat completions request end-to-end', async () => {
    const response = await fetch(`${plexusUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-dummy-key',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello.' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.role).toBe('assistant');
    expect(typeof body.choices[0].message.content).toBe('string');
  });

  it('streams an OpenAI chat completion response correctly', async () => {
    const response = await fetch(`${plexusUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-dummy-key',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
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
    expect(firstEvent.object).toBe('chat.completion.chunk');
  });
});
