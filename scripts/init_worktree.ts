#!/usr/bin/env bun

/**
 * Initialize a freshly-created worktree.
 *
 * This script intentionally avoids external dependencies because it is expected
 * to run before `bun install`. Keep commands as argv arrays instead of shell
 * strings so they work on Linux, macOS, and Windows.
 */

type Command = {
  readonly label: string;
  readonly cmd: readonly string[];
};

const commands: readonly Command[] = [
  { label: 'Trust mise configuration', cmd: ['mise', 'trust'] },
  { label: 'Install mise-managed tools', cmd: ['mise', 'install'] },
  { label: 'Install Bun dependencies', cmd: ['bun', 'install'] },
  { label: 'Build frontend', cmd: ['bun', 'run', 'build:frontend'] },
];

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function formatCommand(command: readonly string[]): string {
  return command.map(quoteArg).join(' ');
}

async function runCommand(command: Command): Promise<void> {
  console.log(`\n==> ${command.label}`);
  console.log(`$ ${formatCommand(command.cmd)}`);

  let proc: Bun.Subprocess<'inherit', 'inherit', 'inherit'>;
  try {
    proc = Bun.spawn([...command.cmd], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: Bun.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start command: ${formatCommand(command.cmd)}\n${message}`);
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${formatCommand(command.cmd)}`);
  }
}

async function main(): Promise<void> {
  for (const command of commands) {
    await runCommand(command);
  }

  console.log('\nWorktree initialization complete.');
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${message}`);
  process.exit(1);
}
