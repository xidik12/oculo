/**
 * Shadow DOM traversal utilities for use inside executeJavaScript() calls.
 *
 * These functions return JavaScript source code (strings) that can be
 * embedded in the IIFEs sent to webContents.executeJavaScript().
 * They define querySelectorAllDeep/querySelectorDeep which recursively
 * traverse shadow roots to find elements invisible to standard queries.
 */

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
  return `
    function querySelectorAllDeep(root, selector) {
      var results = Array.from(root.querySelectorAll(selector));
      var allEls = root.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        if (allEls[i].shadowRoot) {
          var shadowResults = querySelectorAllDeep(allEls[i].shadowRoot, selector);
          for (var j = 0; j < shadowResults.length; j++) {
            results.push(shadowResults[j]);
          }
        }
      }
      return results;
    }

    function querySelectorDeep(root, selector) {
      var result = root.querySelector(selector);
      if (result) return result;
      var allEls = root.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        if (allEls[i].shadowRoot) {
          result = querySelectorDeep(allEls[i].shadowRoot, selector);
          if (result) return result;
        }
      }
      return null;
    }
  `
}
