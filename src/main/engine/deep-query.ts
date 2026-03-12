/**
 * Shadow DOM traversal utilities for use inside executeJavaScript() calls.
 *
 * These functions return JavaScript source code (strings) that can be
 * embedded in the IIFEs sent to webContents.executeJavaScript().
 * They define querySelectorAllDeep/querySelectorDeep which recursively
 * traverse shadow roots to find elements invisible to standard queries.
 */

/**
 * Deep query utility — traverses shadow DOM trees.
 * Returns a JS code string to be injected into webviews.
 */
export const DEEP_QUERY_JS = `
  function querySelectorAllDeep(root, selector) {
    var results = [];
    try { results = Array.from(root.querySelectorAll(selector)); } catch {}
    var allEls = root.querySelectorAll('*');
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      if (el.shadowRoot) {
        try {
          var shadowResults = querySelectorAllDeep(el.shadowRoot, selector);
          for (var j = 0; j < shadowResults.length; j++) {
            results.push(shadowResults[j]);
          }
        } catch {}
      }
    }
    return results;
  }

  function querySelectorDeep(root, selector) {
    var el = root.querySelector(selector);
    if (el) return el;
    var allEls = root.querySelectorAll('*');
    for (var i = 0; i < allEls.length; i++) {
      if (allEls[i].shadowRoot) {
        var found = querySelectorDeep(allEls[i].shadowRoot, selector);
        if (found) return found;
      }
    }
    return null;
  }
`

/**
 * Returns a JS snippet defining deep query functions.
 * Include this at the top of any IIFE that needs to find elements
 * inside Shadow DOM (Web Components, lit-element, etc.).
 *
 * Defines:
 *   querySelectorAllDeep(root, selector) → Element[]
 *   querySelectorDeep(root, selector) → Element | null
 */
export function deepQuerySnippet(): string {
  return DEEP_QUERY_JS
}
