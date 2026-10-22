import { afterEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { useHappyDom } from '../../../test/happydom';
import { copyToClipboard, isClipboardAvailable } from '../clipboard';

useHappyDom();

// happy-dom has no document.execCommand and provides a real navigator.clipboard,
// so these two properties are overridden per test and restored afterwards.
const restores: Array<() => void> = [];

function overrideProperty(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  restores.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else delete (target as Record<string, unknown>)[key];
  });
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  jest.restoreAllMocks();
});

function stubLegacyDocument(execResult = true) {
  const appendChild = spyOn(document.body, 'appendChild');
  const removeChild = spyOn(document.body, 'removeChild');
  const select = spyOn(HTMLTextAreaElement.prototype, 'select');
  const execCommand = mock().mockReturnValue(execResult);
  overrideProperty(document, 'execCommand', execCommand);
  return { appendChild, removeChild, select, execCommand };
}

describe('clipboard helpers', () => {
  it('uses the modern Clipboard API when available', async () => {
    const writeText = mock().mockResolvedValue(undefined);
    overrideProperty(navigator, 'clipboard', { writeText });

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(isClipboardAvailable()).toBe(true);
  });

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    overrideProperty(navigator, 'clipboard', undefined);
    const { appendChild, removeChild, select, execCommand } = stubLegacyDocument();

    await expect(copyToClipboard('sk-secret')).resolves.toBe(true);

    const textarea = appendChild.mock.calls[0]?.[0] as HTMLTextAreaElement;
    expect(textarea.value).toBe('sk-secret');
    expect(select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appendChild).toHaveBeenCalled();
    expect(removeChild).toHaveBeenCalled();
    expect(isClipboardAvailable()).toBe(true);
  });

  it('falls back to execCommand when the modern API throws', async () => {
    const writeText = mock().mockRejectedValue(new Error('denied'));
    overrideProperty(navigator, 'clipboard', { writeText });
    stubLegacyDocument();

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false when execCommand reports failure', async () => {
    overrideProperty(navigator, 'clipboard', undefined);
    stubLegacyDocument(false);

    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });

  it('returns false when neither copy path is available', async () => {
    overrideProperty(navigator, 'clipboard', undefined);
    overrideProperty(document, 'execCommand', undefined);

    await expect(copyToClipboard('hello')).resolves.toBe(false);
    expect(isClipboardAvailable()).toBe(false);
  });
});
