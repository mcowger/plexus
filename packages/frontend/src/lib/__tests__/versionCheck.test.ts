import { describe, expect, it } from 'vitest';
import {
  hasBlockingForm,
  hashText,
  isServerVersionNewer,
  parseHealthzVersion,
  parseVersion,
  type BlockingFormDocument,
} from '../versionCheck';

describe('parseHealthzVersion', () => {
  it('extracts the version string', () => {
    expect(parseHealthzVersion({ ok: true, version: '2026.09.29.1' })).toBe('2026.09.29.1');
  });

  it('returns null when the backend predates the version field', () => {
    expect(parseHealthzVersion({ ok: true })).toBeNull();
  });

  it('returns null for non-object or non-string bodies', () => {
    expect(parseHealthzVersion(null)).toBeNull();
    expect(parseHealthzVersion('OK')).toBeNull();
    expect(parseHealthzVersion({ version: 42 })).toBeNull();
    expect(parseHealthzVersion({ version: '' })).toBeNull();
  });
});

describe('parseVersion', () => {
  it('parses staging timestamps', () => {
    expect(parseVersion('20260929-203041')).toEqual({
      kind: 'timestamp',
      parts: [20260929, 203041],
    });
  });

  it('parses CalVer release tags', () => {
    expect(parseVersion('2026.09.29.3')).toEqual({
      kind: 'calver',
      parts: [2026, 9, 29, 3],
    });
  });

  it('parses dev pre-release shas', () => {
    expect(parseVersion('dev-1a2b3c4d5e6f')).toEqual({ kind: 'dev-sha', parts: [] });
  });

  it('returns null for unorderable or unknown ids', () => {
    expect(parseVersion('dev')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('not-a-version')).toBeNull();
  });
});

describe('isServerVersionNewer', () => {
  it('detects a newer staging deploy', () => {
    expect(isServerVersionNewer('20260929-203041', '20260929-210000')).toBe(true);
  });

  it('ignores an older server build (does not prompt to downgrade)', () => {
    // The reported bug: a poll landing on an older replica must not claim a
    // new version is available.
    expect(isServerVersionNewer('20260929-203041', '20260717-155329')).toBe(false);
  });

  it('ignores identical versions', () => {
    expect(isServerVersionNewer('20260929-203041', '20260929-203041')).toBe(false);
  });

  it('compares CalVer tags numerically', () => {
    expect(isServerVersionNewer('2026.09.29.2', '2026.09.29.10')).toBe(true);
    expect(isServerVersionNewer('2026.09.29.9', '2026.09.30.1')).toBe(true);
    expect(isServerVersionNewer('2026.09.29.10', '2026.09.29.2')).toBe(false);
  });

  it('ignores a missing server version (old backend)', () => {
    expect(isServerVersionNewer('20260929-203041', null)).toBe(false);
  });

  it('treats dev as unknown, never newer', () => {
    expect(isServerVersionNewer('dev', 'dev')).toBe(false);
    expect(isServerVersionNewer('dev', '20260929-203041')).toBe(false);
    expect(isServerVersionNewer('20260929-203041', 'dev')).toBe(false);
  });

  it('never treats unrecognized ids as newer', () => {
    expect(isServerVersionNewer('20260929-203041', 'not-a-version')).toBe(false);
    expect(isServerVersionNewer('not-a-version', '20260929-203041')).toBe(false);
  });

  it('does not compare across id formats', () => {
    expect(isServerVersionNewer('2026.09.29.1', '20260929-203041')).toBe(false);
    expect(isServerVersionNewer('20260929-203041', '2026.09.29.1')).toBe(false);
  });

  it('treats a changed dev sha as a move (shas are unordered)', () => {
    expect(isServerVersionNewer('dev-1a2b3c4d5e6f', 'dev-abcdef012345')).toBe(true);
    expect(isServerVersionNewer('dev-1a2b3c4d5e6f', 'dev-1a2b3c4d5e6f')).toBe(false);
    expect(isServerVersionNewer('dev-1a2b3c4d5e6f', '20260929-203041')).toBe(false);
  });
});

describe('hashText', () => {
  it('is deterministic', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
  });

  it('distinguishes different bundle contents', () => {
    expect(hashText('console.log(1)')).not.toBe(hashText('console.log(2)'));
  });

  it('returns a hex string', () => {
    expect(hashText('x')).toMatch(/^[0-9a-f]+$/);
  });
});

const fakeDoc = (
  overrides: Partial<Record<'dialog' | 'tag' | 'editable', unknown>>
): BlockingFormDocument => ({
  querySelector: () => (overrides.dialog ? {} : null),
  activeElement:
    overrides.tag || overrides.editable
      ? { tagName: (overrides.tag as string) ?? 'DIV', isContentEditable: !!overrides.editable }
      : null,
});

describe('hasBlockingForm', () => {
  it('returns false with no document', () => {
    expect(hasBlockingForm(null)).toBe(false);
    expect(hasBlockingForm(undefined)).toBe(false);
  });

  it('blocks when a dialog is open', () => {
    expect(hasBlockingForm(fakeDoc({ dialog: true }))).toBe(true);
  });

  it('blocks when focus is in an editable field', () => {
    expect(hasBlockingForm(fakeDoc({ tag: 'INPUT' }))).toBe(true);
    expect(hasBlockingForm(fakeDoc({ tag: 'textarea' }))).toBe(true);
    expect(hasBlockingForm(fakeDoc({ tag: 'SELECT' }))).toBe(true);
    expect(hasBlockingForm(fakeDoc({ editable: true }))).toBe(true);
  });

  it('reloads freely otherwise', () => {
    expect(hasBlockingForm(fakeDoc({}))).toBe(false);
    expect(hasBlockingForm(fakeDoc({ tag: 'BUTTON' }))).toBe(false);
    expect(hasBlockingForm(fakeDoc({ tag: 'DIV' }))).toBe(false);
  });
});
