import { describe, expect, it } from 'bun:test';

import { resolvePostgresSsl } from '../client';

describe('resolvePostgresSsl', () => {
  it('defaults to plaintext when no sslmode is given, preserving local behaviour', () => {
    expect(resolvePostgresSsl('postgres://user:pass@localhost:5432/plexus')).toBe(false);
    expect(
      resolvePostgresSsl('postgres://user:pass@localhost:5432/plexus?application_name=plexus')
    ).toBe(false);
  });

  it('maps disable to plaintext', () => {
    expect(resolvePostgresSsl('postgres://user:pass@localhost:5432/plexus?sslmode=disable')).toBe(
      false
    );
  });

  it('passes allow, prefer, and require through to postgres-js', () => {
    expect(resolvePostgresSsl('postgres://host/db?sslmode=allow')).toBe('allow');
    expect(resolvePostgresSsl('postgres://host/db?sslmode=prefer')).toBe('prefer');
    expect(resolvePostgresSsl('postgres://host/db?sslmode=require')).toBe('require');
  });

  it('normalizes verify-ca to verify-full, which postgres-js supports', () => {
    expect(resolvePostgresSsl('postgres://host/db?sslmode=verify-ca')).toBe('verify-full');
    expect(resolvePostgresSsl('postgres://host/db?sslmode=verify-full')).toBe('verify-full');
  });

  it('treats sslmode case-insensitively', () => {
    expect(resolvePostgresSsl('postgres://host/db?sslmode=Require')).toBe('require');
    expect(resolvePostgresSsl('postgres://host/db?sslmode=VERIFY-FULL')).toBe('verify-full');
  });

  it('upgrades to verify-full when sslrootcert=system, matching postgres-js', () => {
    expect(resolvePostgresSsl('postgres://host/db?sslrootcert=system')).toBe('verify-full');
    expect(resolvePostgresSsl('postgres://host/db?sslmode=require&sslrootcert=system')).toBe(
      'verify-full'
    );
  });

  it('throws on an unrecognised sslmode instead of silently using plaintext', () => {
    expect(() => resolvePostgresSsl('postgres://host/db?sslmode=bogus')).toThrow(
      'Invalid sslmode in database connection string: "bogus"'
    );
  });

  it('defers to postgres-js for multi-host strings that new URL cannot parse', () => {
    // new URL() throws on the comma-separated host list, but postgres-js
    // parses it by rewriting the host first. Returning false here would
    // set an explicit ssl option and silently drop the requested sslmode,
    // so the result must be undefined and the call site must omit ssl.
    expect(
      resolvePostgresSsl('postgres://user:pass@h1:5432,h2:5432/plexus?sslmode=require')
    ).toBeUndefined();
    expect(
      resolvePostgresSsl('postgres://user:pass@h1:5432,h2:5432/plexus?sslmode=verify-full')
    ).toBeUndefined();
    expect(
      resolvePostgresSsl('postgres://user:pass@h1:5432,h2:5432/plexus?sslrootcert=system')
    ).toBeUndefined();
    expect(resolvePostgresSsl('postgres://user:pass@h1:5432,h2:5432/plexus')).toBeUndefined();
  });
});
