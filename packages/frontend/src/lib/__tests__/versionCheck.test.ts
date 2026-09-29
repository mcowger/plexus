import { describe, expect, it } from 'vitest';
import {
  hasBlockingForm,
  hashText,
  isVersionStale,
  parseHealthzVersion,
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

describe('isVersionStale', () => {
  it('detects a redeploy', () => {
    expect(isVersionStale('a', 'b')).toBe(true);
  });

  it('matches identical versions', () => {
    expect(isVersionStale('a', 'a')).toBe(false);
  });

  it('ignores a missing server version (old backend)', () => {
    expect(isVersionStale('a', null)).toBe(false);
  });

  it('treats dev as unknown, never stale', () => {
    expect(isVersionStale('dev', 'dev')).toBe(false);
    expect(isVersionStale('dev', '2026.09.29.1')).toBe(false);
    expect(isVersionStale('2026.09.29.1', 'dev')).toBe(false);
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
