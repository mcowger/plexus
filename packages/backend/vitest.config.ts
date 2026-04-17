import { defineConfig } from 'vitest/config';

const isStructuredLoggerLine = (log: string) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[/.test(log);

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    exclude: [
      '../frontend/**',
      '../../node_modules/**',
      'node_modules/**',
      'dist/**',
      'test/bun-test-guard/**',
    ],
    setupFiles: ['./test/vitest.setup.ts'],
    globalSetup: ['./test/vitest.global-setup.ts'],
    environment: 'node',
    reporters: ['dot'],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    pool: 'forks',
    server: {
      deps: {
        inline: ['zod', 'yaml', '@plexus/shared', '@mariozechner/pi-ai'],
      },
    },
    onConsoleLog(log, type) {
      if (
        (type === 'stdout' || type === 'stderr') &&
        (isStructuredLoggerLine(log) ||
          log.includes('Running sqlite migrations...') ||
          log.includes('Loaded ') ||
          log.includes('Migrations completed successfully'))
      ) {
        return false;
      }
    },
  },
});
