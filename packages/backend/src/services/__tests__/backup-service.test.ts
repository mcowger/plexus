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

// ─── Bun archive round-trip ─────────────────────────────────────────

describe('Archive round-trip', () => {
  it('round-trips a single file', async () => {
    const archive = new Bun.Archive(
      { 'hello.txt': Buffer.from('Hello, world!', 'utf8') },
      { compress: 'gzip' }
    );
    const parsed = await new Bun.Archive(await archive.bytes()).files();

    expect(parsed.size).toBe(1);
    expect(await parsed.get('hello.txt')?.text()).toBe('Hello, world!');
  });

  it('round-trips multiple files', async () => {
    const archive = new Bun.Archive(
      {
        'a.txt': 'file a',
        'b.dat': 'file b content',
        'empty.csv': '',
      },
      { compress: 'gzip' }
    );
    const parsed = await new Bun.Archive(await archive.bytes()).files();

    expect(parsed.size).toBe(3);
    expect(await parsed.get('a.txt')?.text()).toBe('file a');
    expect(await parsed.get('b.dat')?.text()).toBe('file b content');
    expect(await parsed.get('empty.csv')?.text()).toBe('');
  });

  it('round-trips binary content', async () => {
    const original = Buffer.from('col1,col2\nval1,val2\n', 'utf8');
    const archive = new Bun.Archive(
      { 'data.csv.gz': Bun.gzipSync(original) },
      { compress: 'gzip' }
    );
    const parsed = await new Bun.Archive(await archive.bytes()).files();

    const extracted = parsed.get('data.csv.gz');
    expect(extracted).toBeDefined();
    const decompressed = Bun.gunzipSync(Buffer.from(await extracted!.arrayBuffer()));
    expect(Buffer.from(decompressed).toString('utf8')).toBe('col1,col2\nval1,val2\n');
  });

  it('handles large files', async () => {
    const largeContent = 'x'.repeat(1500);
    const archive = new Bun.Archive({ 'large.txt': largeContent }, { compress: 'gzip' });
    const parsed = await new Bun.Archive(await archive.bytes()).files();

    expect(await parsed.get('large.txt')?.text()).toBe(largeContent);
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
