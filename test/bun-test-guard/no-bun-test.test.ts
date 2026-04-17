import { test } from 'bun:test';

test('do not use bun test from repo root', () => {
  throw new Error(
    "Do not use 'bun test' from the repo root. Use 'cd packages/backend && bun run test' or 'cd packages/backend && bun run test:watch' instead."
  );
});
