/**
 * CSS.escape polyfill -- MUST be defined before any other imports.
 *
 * Why this is needed:
 *   Monaco Editor v0.55.1+ internally calls CSS.escape() to generate scoped CSS
 *   class names for its editor widgets, syntax highlighting tokens, and overlay
 *   elements. If CSS.escape is undefined, Monaco throws a TypeError at
 *   initialization time, which crashes the entire Config page editor.
 *
 * Why it must be before React imports:
 *   ES module imports are hoisted to the top of the module and evaluated before
 *   any other code. However, top-level side effects (like this polyfill assignment)
 *   that appear BEFORE import statements are executed first in the module
 *   evaluation order. By placing this polyfill above all imports, we guarantee
 *   CSS.escape is available by the time Monaco's module is lazily loaded and
 *   initialized. If we placed it after the imports, React and its dependency
 *   tree could trigger Monaco's lazy-loading before the polyfill runs.
 *
 * Browser compatibility:
 *   CSS.escape is supported in all modern browsers (Chrome 46+, Firefox 31+,
 *   Safari 10+, Edge 79+), but may be absent in older WebViews, embedded
 *   browsers (e.g., Electron with old Chromium), or environments where the
 *   CSS global object exists but escape() was not implemented. The guard
 *   `typeof CSS !== 'undefined' && typeof CSS.escape !== 'function'` ensures
 *   we only polyfill when the CSS object exists but escape() is missing --
 *   we do not create a CSS object from scratch if it does not exist at all.
 *
 * Implementation:
 *   This is a faithful implementation of the CSSOM spec for CSS.escape():
 *   https://drafts.csswg.org/cssom/#the-css.escape()-method
 *   It handles null bytes (replaced with U+FFFD), control characters (hex-escaped),
 *   leading digits (which are invalid at the start of CSS identifiers), lone
 *   hyphens, and all other characters that need backslash-escaping per the spec.
 */
if (typeof CSS !== 'undefined' && typeof CSS.escape !== 'function') {
  CSS.escape = (value: string): string => {
    const str = String(value);
    const len = str.length;
    let result = '';
    for (let i = 0; i < len; i++) {
      const ch = str.charCodeAt(i);
      // Null bytes are replaced with the Unicode replacement character (U+FFFD)
      if (ch === 0) {
        result += '\uFFFD';
      } else if (
        // Control characters (U+0001 to U+001F, U+007F) and leading digits
        // must be hex-escaped (e.g., \31 for '1') because they are not valid
        // at certain positions in CSS identifiers.
        (ch >= 0x0001 && ch <= 0x001f) ||
        ch === 0x007f ||
        (i === 0 && ch >= 0x0030 && ch <= 0x0039) ||
        (i === 1 && ch >= 0x0030 && ch <= 0x0039 && str.charCodeAt(0) === 0x002d)
      ) {
        result += `\\${ch.toString(16)} `;
      } else if (i === 0 && ch === 0x002d && len === 1) {
        // A lone hyphen at the start must be backslash-escaped
        result += `\\${str.charAt(i)}`;
      } else if (
        // Characters that are safe to include verbatim in CSS identifiers:
        // non-ASCII (U+0080+), hyphens, underscores, digits (non-leading),
        // uppercase letters, and lowercase letters.
        ch >= 0x0080 ||
        ch === 0x002d ||
        ch === 0x005f ||
        (ch >= 0x0030 && ch <= 0x0039) ||
        (ch >= 0x0041 && ch <= 0x005a) ||
        (ch >= 0x0061 && ch <= 0x007a)
      ) {
        result += str.charAt(i);
      } else {
        // Everything else (punctuation, symbols, etc.) is backslash-escaped
        result += `\\${str.charAt(i)}`;
      }
    }
    return result;
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/ui">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
