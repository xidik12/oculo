import { WebContents } from 'electron'
import { deepQuerySnippet } from './deep-query'

/**
 * Generates a minimal page description by executing JS in the webview.
 * This runs entirely in the page's V8 context — zero tokens sent to AI.
 * Returns a compact string like:
 * "Login Page | https://example.com/login
 *  Forms: email (text, empty), password (password, empty)
 *  Buttons: [Sign In] [Create Account]
 *  Links: Forgot Password, Help"
 */
export class PageDescriber {
  /**
   * Describe the current page in compact format
   * @param webContents - the webview's webContents
   * @param options - scope (CSS selector), include (categories to include)
   */
  async describe(
    webContents: WebContents,
    options?: { scope?: string; include?: string[] }
  ): Promise<string> {
    const scope = options?.scope || 'body'
    const include = options?.include || ['forms', 'buttons', 'links', 'headings']

    // This entire script runs inside the page — zero MCP tokens
    const script = `
      (function() {
        ${deepQuerySnippet()}
        const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
        const result = [];

        // URL and title
        result.push(document.title + ' | ' + location.href);
        result.push('');

        const includes = ${JSON.stringify(include)};

        // Headings
        if (includes.includes('headings')) {
          const headings = querySelectorAllDeep(root, 'h1, h2, h3');
          const hTexts = [];
          headings.forEach(h => {
            const text = h.textContent?.trim();
            if (text && text.length < 100) hTexts.push(text);
          });
          if (hTexts.length > 0) result.push('Headings: ' + hTexts.slice(0, 5).join(' > '));
        }

        // Forms
        if (includes.includes('forms')) {
          // Find ALL visible inputs, textareas, selects — including those without <label>,
          // with only placeholder, aria-label, aria-labelledby, or name attributes.
          // Also find contenteditable and role-based inputs common in modern SPAs.
          const inputs = querySelectorAllDeep(root,
            'input:not([type="hidden"]), textarea, select, ' +
            '[role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"], ' +
            '[contenteditable="true"], [contenteditable=""]'
          );
          const seen = new Set();
          const fields = [];
          inputs.forEach(el => {
            // Deduplicate (a real <input> might also match [role="textbox"])
            if (seen.has(el)) return;
            seen.add(el);
            {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
              // Skip zero-size elements (common hidden inputs)
              if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
            }
            const input = el;
            let label = '';

            // Label resolution priority: explicit label > implicit label > aria-label > aria-labelledby > placeholder > title > siblings > name
            // 1. Explicit <label for="id">
            if (input.id) {
              try {
                const labelEl = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
                if (labelEl) label = labelEl.textContent?.trim() || '';
              } catch(e) {}
            }
            // 2. Implicit label (input inside <label>) — exclude input's own text
            if (!label && input.closest && input.closest('label')) {
              var parentLabel = input.closest('label');
              var clone = parentLabel.cloneNode(true);
              clone.querySelectorAll('input, textarea, select').forEach(function(c) { c.remove(); });
              label = clone.textContent?.trim() || '';
            }
            // 3. aria-label
            if (!label) label = input.getAttribute('aria-label') || '';
            // 4. aria-labelledby (supports space-separated IDs)
            if (!label) {
              const labelledBy = input.getAttribute('aria-labelledby');
              if (labelledBy) {
                const parts = labelledBy.split(/\\s+/).map(function(id) {
                  var refEl = document.getElementById(id);
                  return refEl ? (refEl.textContent?.trim() || '') : '';
                }).filter(function(s) { return s.length > 0; });
                if (parts.length) label = parts.join(' ');
              }
            }
            // 5. placeholder
            if (!label) label = input.getAttribute('placeholder') || '';
            // 6. title attribute
            if (!label) label = input.getAttribute('title') || '';
            // 7. Preceding sibling text (floating labels, adjacent spans)
            if (!label) {
              const prev = input.previousElementSibling;
              if (prev && ['LABEL', 'SPAN', 'DIV', 'P'].includes(prev.tagName)) {
                const prevText = prev.textContent?.trim() || '';
                if (prevText.length > 0 && prevText.length < 50) label = prevText;
              }
            }
            // 8. Following sibling (some forms put label after input)
            if (!label) {
              const next = input.nextElementSibling;
              if (next && ['LABEL', 'SPAN'].includes(next.tagName)) {
                const nextText = next.textContent?.trim() || '';
                if (nextText.length > 0 && nextText.length < 50) label = nextText;
              }
            }
            // 9. name attribute as fallback
            if (!label) label = input.getAttribute('name') || '';

            const type = input.getAttribute('type') || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName === 'SELECT' ? 'select' : input.getAttribute('role') || input.tagName.toLowerCase());
            let value = '';
            if (type === 'password') {
              value = input.value ? '***' : 'empty';
            } else if (type === 'checkbox' || type === 'radio') {
              // Fix 2: Use el.checked DOM property (not attribute) — attribute is the default, property is the live state
              value = (input.checked === true) ? 'checked' : 'unchecked';
            } else if (input.tagName === 'SELECT') {
              value = (input.options && input.options[input.selectedIndex]) ? String(input.options[input.selectedIndex].text) : 'empty';
            } else {
              // Fix 3: Convert value to string before calling .substring() — number inputs can return numeric values
              var rawVal = (input.value !== undefined && input.value !== null) ? String(input.value) : '';
              value = rawVal.length > 0 ? rawVal.substring(0, 30) : 'empty';
            }

            const displayLabel = label || input.getAttribute('name') || input.id || type;
            fields.push(String(displayLabel).substring(0, 30) + ' (' + type + ', ' + value + ')');
          });
          if (fields.length > 0) result.push('Forms: ' + fields.join(', '));
        }

        // Buttons
        if (includes.includes('buttons')) {
          const buttons = querySelectorAllDeep(root, 'button, input[type="submit"], input[type="button"], [role="button"]');
          const btnTexts = [];
          buttons.forEach(btn => {
            { const cs = getComputedStyle(btn); if (cs.display === 'none' || cs.visibility === 'hidden') return; }
            const text = btn.textContent?.trim() || btn.getAttribute('value') || btn.getAttribute('aria-label') || '';
            if (text && text.length < 50 && !text.includes('\\n')) btnTexts.push('[' + text + ']');
          });
          if (btnTexts.length > 0) result.push('Buttons: ' + [...new Set(btnTexts)].slice(0, 10).join(' '));
        }

        // Links (region-aware: content links first, then nav links)
        if (includes.includes('links')) {
          const navContainers = new Set();
          querySelectorAllDeep(root, 'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(el => navContainers.add(el));

          function isNavLink(a) {
            let el = a.parentElement;
            while (el && el !== root) {
              if (navContainers.has(el)) return true;
              el = el.parentElement;
            }
            return false;
          }

          const contentLinks = [];
          const navLinks = [];
          const seen = new Set();
          querySelectorAllDeep(root, 'a[href]').forEach(a => {
            { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') return; }
            let text = a.textContent?.trim();
            if (!text || text.length < 2 || text.length > 120 || text.includes('\\n')) return;
            if (seen.has(text)) return;
            seen.add(text);
            const display = text.length > 80 ? text.substring(0, 80) + '...' : text;
            if (isNavLink(a)) {
              navLinks.push(display);
            } else {
              contentLinks.push(display);
            }
          });
          const picked = contentLinks.slice(0, 12).concat(navLinks.slice(0, 3));
          if (picked.length > 0) result.push('Links: ' + picked.join(', '));
        }

        // Text content (main content summary)
        if (includes.includes('text')) {
          const main = root.querySelector('main, article, [role="main"], .content, #content') || root;
          const text = main.textContent?.trim().replace(/\\s+/g, ' ').substring(0, 500);
          if (text) result.push('Content: ' + text);
        }

        // Images
        if (includes.includes('images')) {
          const imgs = querySelectorAllDeep(root, 'img[alt]');
          const imgTexts = [];
          imgs.forEach(img => {
            { const cs = getComputedStyle(img); if (cs.display === 'none' || cs.visibility === 'hidden') return; }
            const alt = img.getAttribute('alt')?.trim();
            if (alt && alt.length > 2) imgTexts.push(alt);
          });
          if (imgTexts.length > 0) result.push('Images: ' + imgTexts.slice(0, 5).join(', '));
        }

        return result.join('\\n');
      })()
    `

    try {
      return await webContents.executeJavaScript(script)
    } catch (err) {
      return `Error describing page: ${(err as Error).message}`
    }
  }
}
