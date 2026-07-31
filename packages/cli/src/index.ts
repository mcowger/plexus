#!/usr/bin/env bun
import { run } from './cli';

const exitCode = await run(process.argv.slice(2), process.env, {
  fetch,
  stdin: async () => new Response(Bun.stdin.stream()).text(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTTY: Boolean(process.stdout.isTTY),
  confirm: async (message) => {
    if (!process.stdin.isTTY) return false;
    process.stderr.write(`${message} [y/N] `);
    const answer = (await new Response(Bun.stdin.stream()).text()).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  },
});

process.exitCode = exitCode;
