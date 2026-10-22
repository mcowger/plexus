import { describe, expect, it, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  getPaseoScriptStatus,
  isPaseoScriptAvailable,
  startPaseoScript,
  stopPaseoScript,
} from '../lib/paseo';
import { loadPaseoScriptConfig, resolveFallbackCommand } from '../lib/script-runner';

describe('script-runner helper', () => {
  it('loads script config from paseo.json for specified target', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'plexus-test-runner-'));
    try {
      writeFileSync(
        join(tempDir, 'paseo.json'),
        JSON.stringify({
          scripts: {
            'dev:full': {
              type: 'service',
              command: 'PORT=$PASEO_PORT bun run dev:full --no-open',
            },
          },
        })
      );

      const config = loadPaseoScriptConfig('dev:full', tempDir);
      expect(config).toEqual({
        type: 'service',
        command: 'PORT=$PASEO_PORT bun run dev:full --no-open',
      });

      const resolved = resolveFallbackCommand(config!, '15000');
      expect(resolved).toBe('PORT=15000 bun run dev:full --no-open');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns null if target is not defined in paseo.json', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'plexus-test-runner-'));
    try {
      writeFileSync(join(tempDir, 'paseo.json'), JSON.stringify({ scripts: {} }));

      const config = loadPaseoScriptConfig('nonexistent', tempDir);
      expect(config).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('paseo adapter graceful fallbacks when paseo CLI is unavailable or non-zero', () => {
  it('isPaseoScriptAvailable returns false gracefully when directory is not a Paseo workspace or paseo CLI fails', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'plexus-test-adapter-'));
    try {
      const available = isPaseoScriptAvailable('dev:full', tempDir);
      expect(typeof available).toBe('boolean');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('getPaseoScriptStatus returns null gracefully when paseo CLI fails', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'plexus-test-adapter-'));
    try {
      const status = getPaseoScriptStatus('dev:full', tempDir);
      expect(status).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('startPaseoScript returns null gracefully when paseo CLI fails', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'plexus-test-adapter-'));
    try {
      const result = startPaseoScript('dev:full', tempDir);
      expect(result).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('stopPaseoScript returns false gracefully when paseo CLI fails', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'plexus-test-adapter-'));
    try {
      const result = stopPaseoScript('dev:full', tempDir);
      expect(result).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
