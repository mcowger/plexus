// happy-dom globals (window, document, localStorage, navigator) for frontend tests.
//
// Call `useHappyDom()` at the top level of a test file that needs the DOM. It
// registers the globals before that file's tests and unregisters them after,
// so they never leak into other test files — happy-dom replaces web-platform
// globals such as `fetch` and the stream classes, which would break backend
// tests running later in the same process.
import { afterAll, beforeAll } from 'bun:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

export function useHappyDom(): void {
  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
  });
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  });
}

/** Point happy-dom's window at `url` (e.g. to drive code that reads `location.pathname`). */
export function setLocation(url: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}
