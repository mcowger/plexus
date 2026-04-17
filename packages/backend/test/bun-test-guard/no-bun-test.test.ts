import { test } from 'bun:test';

test('do not use bun test', () => {
  throw new Error(
    "Do not use 'bun test'. Use 'cd packages/backend && bun run test' or 'cd packages/backend && bun run test:watch' instead."
  );
});
