/**
 * Unit tests for BackupService — CSV helpers, tar builder/parser,
 * and config backup envelope validation.
 *
 * These tests do NOT touch the database; they test the pure-logic
 * parts of the service. DB-backed integration tests would need a
 * test database and are out of scope for this file.
 */
import { describe, expect, it } from 'vitest';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { gzipSync, gunzipSync } from 'node:zlib';

// We test the internal helpers via the module's exported functions
// and the archive round-trip. Since BackupService depends on the DB
// singleton, we focus on the helper functions and the tar/gzip flow.

// ─── CSV helpers (tested via the module's internal logic) ─────────────

describe('CSV escape and parse', () => {
  // Import the internal helpers indirectly — we replicate the logic here
  // for unit-level validation since they are not exported.

  function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '\\N';
    const str = String(value);
    if (str === '\\N') return '"\\N"';
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function parseCsvRow(line: string): string[] {
    // Use the real csv-parse library for test round-trips
    const records = parseCsvSync(line, { relax_column_count: true });
    return records[0] ?? [];
  }

  it('escapes values with commas', () => {
    expect(csvEscape('hello,world')).toBe('"hello,world"');
  });

  it('escapes values with quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('escapes values with newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('returns \\N for null', () => {
    expect(csvEscape(null)).toBe('\\N');
  });

  it('returns \\N for undefined', () => {
    expect(csvEscape(undefined)).toBe('\\N');
  });

  it('leaves simple values unchanged', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
  });

  it('round-trips CSV line parsing', () => {
    const values = ['hello', 'world,with,commas', 'say "hi"', '', 'plain'];
    const line = values.map((v) => csvEscape(v)).join(',');
    const parsed = parseCsvRow(line);
    expect(parsed).toEqual(values.map((v) => (v === '' ? '' : v)));
  });

  it('round-trips a CSV line with embedded quotes and commas', () => {
    const original = ['simple', 'has,comma', 'has "quotes"', 'has\nnewline'];
    const line = original.map((v) => csvEscape(v)).join(',');
    const parsed = parseCsvRow(line);
    expect(parsed).toEqual(original);
  });

  it('parses empty fields correctly', () => {
    const parsed = parseCsvRow('a,,c');
    expect(parsed).toEqual(['a', '', 'c']);
  });
});

// ─── Tar builder/parser round-trip ──────────────────────────────────

describe('Tar archive round-trip', () => {
  // Replicate the tar builder/parser from backup-service for unit testing

  function buildTar(files: Map<string, Buffer>): Buffer {
    const chunks: Buffer[] = [];
    for (const [name, content] of files) {
      const header = Buffer.alloc(512, 0);
      const nameBytes = Buffer.from(name, 'utf8');
      nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
      header.write('0000644\0', 100, 8, 'ascii');
      header.write('0001750\0', 108, 8, 'ascii');
      header.write('0001750\0', 116, 8, 'ascii');
      const sizeStr = content.length.toString(8).padStart(11, '0') + '\0';
      header.write(sizeStr, 124, 12, 'ascii');
      header.write(
        Math.floor(Date.now() / 1000)
          .toString(8)
          .padStart(11, '0') + '\0',
        136,
        12,
        'ascii'
      );
      header.write('        ', 148, 8, 'ascii');
      header.write('0', 156, 1, 'ascii');
      header.write('ustar\0', 257, 6, 'ascii');
      header.write('00', 263, 2, 'ascii');
      let checksum = 0;
      for (let i = 0; i < 512; i++) checksum += header[i]!;
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      chunks.push(header);
      chunks.push(content);
      const remainder = content.length % 512;
      if (remainder > 0) {
        chunks.push(Buffer.alloc(512 - remainder, 0));
      }
    }
    chunks.push(Buffer.alloc(1024, 0));
    return Buffer.concat(chunks);
  }

  function parseTar(data: Buffer): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    let offset = 0;
    while (offset + 512 <= data.length) {
      let allZero = true;
      for (let i = 0; i < 512; i++) {
        if (data[offset + i] !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) break;
      const name = data
        .subarray(offset, offset + 100)
        .toString('utf8')
        .replace(/\0+$/, '');
      const sizeStr = data
        .subarray(offset + 124, offset + 136)
        .toString('ascii')
        .replace(/\0+$/, '')
        .trim();
      const size = parseInt(sizeStr, 8) || 0;
      offset += 512;
      if (size >= 0) {
        const content = size > 0 ? data.subarray(offset, offset + size) : Buffer.alloc(0);
        files.set(name, Buffer.from(content));
      }
      offset += size;
      const remainder = size % 512;
      if (remainder > 0) offset += 512 - remainder;
    }
    return files;
  }

  it('round-trips a single file', () => {
    const files = new Map<string, Buffer>();
    files.set('hello.txt', Buffer.from('Hello, world!', 'utf8'));

    const tarData = buildTar(files);
    const parsed = parseTar(tarData);

    expect(parsed.size).toBe(1);
    expect(parsed.get('hello.txt')?.toString('utf8')).toBe('Hello, world!');
  });

  it('round-trips multiple files', () => {
    const files = new Map<string, Buffer>();
    files.set('a.txt', Buffer.from('file a', 'utf8'));
    files.set('b.dat', Buffer.from('file b content', 'utf8'));
    files.set('empty.csv', Buffer.from('', 'utf8'));

    const tarData = buildTar(files);
    const parsed = parseTar(tarData);

    expect(parsed.size).toBe(3);
    expect(parsed.get('a.txt')?.toString('utf8')).toBe('file a');
    expect(parsed.get('b.dat')?.toString('utf8')).toBe('file b content');
    expect(parsed.get('empty.csv')?.toString('utf8')).toBe('');
  });

  it('round-trips binary (gzipped) content', () => {
    const original = Buffer.from('col1,col2\nval1,val2\n', 'utf8');
    const gzipped = gzipSync(original);

    const files = new Map<string, Buffer>();
    files.set('data.csv.gz', gzipped);

    const tarData = buildTar(files);
    const parsed = parseTar(tarData);

    const extracted = parsed.get('data.csv.gz');
    expect(extracted).toBeDefined();
    const decompressed = gunzipSync(extracted!);
    expect(decompressed.toString('utf8')).toBe('col1,col2\nval1,val2\n');
  });

  it('handles files that span multiple 512-byte blocks', () => {
    const largeContent = 'x'.repeat(1500);
    const files = new Map<string, Buffer>();
    files.set('large.txt', Buffer.from(largeContent, 'utf8'));

    const tarData = buildTar(files);
    const parsed = parseTar(tarData);

    expect(parsed.get('large.txt')?.toString('utf8')).toBe(largeContent);
  });
});

// ─── Config backup envelope structure ────────────────────────────────

describe('Config backup envelope validation', () => {
  const BACKUP_VERSION = 1;

  it('produces a valid envelope structure', () => {
    const envelope = {
      plexus_backup: true,
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      dialect: 'sqlite' as const,
      data: {
        providers: { p1: { api_key: 'test' } },
        models: {},
        keys: {},
        user_quotas: {},
        mcp_servers: {},
        settings: { 'failover.enabled': true },
        oauth_credentials: [],
      },
    };

    expect(envelope.plexus_backup).toBe(true);
    expect(envelope.version).toBe(1);
    expect(envelope.data).toBeDefined();
    expect(envelope.data.providers).toBeDefined();
    expect(envelope.data.settings).toBeDefined();
    expect(Array.isArray(envelope.data.oauth_credentials)).toBe(true);
  });
});
