/**
 * Recording script for E2E test fixtures.
 *
 * Run this script with real API keys to capture upstream API responses
 * into NDJSON fixture files. These fixtures are then replayed by the
 * FixtureServer during E2E tests, enabling deterministic, cost-free test runs.
 *
 * Usage:
 *   NODE_EXTRA_CA_CERTS=test/fixtures/testCA.pem \
 *     ANTHROPIC_API_KEY=sk-ant-... \
 *     bun run scripts/record-fixtures.ts
 *
 * Only run when you need to refresh fixtures — this hits real APIs
 * and incurs charges.
 */
import { runRecorder } from '../test/support/recorder';

// Record: Anthropic basic completion (non-streaming)
await runRecorder('basic-completion', 'anthropic', async (upstreamUrl) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const response = await fetch(`${upstreamUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say hello.' }],
    }),
  });
  await response.json();
});

// Record: Anthropic streaming completion
await runRecorder('streaming-completion', 'anthropic', async (upstreamUrl) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const response = await fetch(`${upstreamUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      stream: true,
      messages: [{ role: 'user', content: 'Say hello.' }],
    }),
  });
  // Drain the stream
  for await (const _ of response.body!) {
  }
});

// Record: OpenAI basic completion (non-streaming)
await runRecorder('basic-completion', 'openai', async (upstreamUrl) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const response = await fetch(`${upstreamUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Say hello.' }],
    }),
  });
  await response.json();
});

// Record: OpenAI streaming chat
await runRecorder('streaming-chat', 'openai', async (upstreamUrl) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const response = await fetch(`${upstreamUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      stream: true,
      messages: [{ role: 'user', content: 'Say hello.' }],
    }),
  });
  // Drain the stream
  for await (const _ of response.body!) {
  }
});

console.log('Fixture recording complete.');
