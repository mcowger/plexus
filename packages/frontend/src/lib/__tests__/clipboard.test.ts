import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard, isClipboardAvailable } from '../clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLegacyDocument(execResult = true) {
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  const textarea = {
    value: '',
    style: {} as Record<string, string>,
    parentNode: body as unknown as Node,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const execCommand = vi.fn().mockReturnValue(execResult);
  vi.stubGlobal('document', {
    createElement: vi.fn().mockReturnValue(textarea),
    body,
    execCommand,
  });
  return { textarea, body, execCommand };
}

describe('clipboard helpers', () => {
  it('uses the modern Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(isClipboardAvailable()).toBe(true);
  });

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const { textarea, body, execCommand } = stubLegacyDocument();

    await expect(copyToClipboard('sk-secret')).resolves.toBe(true);

    expect(textarea.value).toBe('sk-secret');
    expect(textarea.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(body.appendChild).toHaveBeenCalled();
    expect(body.removeChild).toHaveBeenCalled();
    expect(isClipboardAvailable()).toBe(true);
  });

  it('falls back to execCommand when the modern API throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubLegacyDocument();

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false when execCommand reports failure', async () => {
    vi.stubGlobal('navigator', {});
    stubLegacyDocument(false);

    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });

  it('returns false when neither copy path is available', async () => {
    vi.stubGlobal('navigator', {});

    await expect(copyToClipboard('hello')).resolves.toBe(false);
    expect(isClipboardAvailable()).toBe(false);
  });
});
