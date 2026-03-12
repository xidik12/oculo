import { WebContents } from 'electron'

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
        const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
        const result = [];
        
        // URL and title
        result.push(document.title + ' | ' + location.href);
        result.push('');

        const includes = ${JSON.stringify(include)};
        
        // Headings
        if (includes.includes('headings')) {
          const headings = root.querySelectorAll('h1, h2, h3');
          const hTexts = [];
          headings.forEach(h => {
            const text = h.textContent?.trim();
            if (text && text.length < 100) hTexts.push(text);
          });
          if (hTexts.length > 0) result.push('Headings: ' + hTexts.slice(0, 5).join(' > '));
        }

        // Forms
        if (includes.includes('forms')) {
          // Find all visible inputs, textareas, selects (even outside <form> tags for SPAs)
          const inputs = root.querySelectorAll('input:not([type="hidden"]), textarea, select');
          const fields = [];
          inputs.forEach(el => {
            {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') return; // skip invisible
            }
            const input = el;
            let label = '';
            
            // Try to find label
            if (input.id) {
              const labelEl = document.querySelector('label[for="' + input.id + '"]');
              if (labelEl) label = labelEl.textContent?.trim() || '';
            }
            if (!label && input.closest('label')) {
              label = input.closest('label')?.textContent?.trim() || '';
            }
            if (!label) label = input.getAttribute('aria-label') || '';
            if (!label) {
              // Try aria-labelledby
              const labelledBy = input.getAttribute('aria-labelledby');
              if (labelledBy) {
                const refEl = document.getElementById(labelledBy);
                if (refEl) label = refEl.textContent?.trim() || '';
              }
            }
            if (!label) label = input.getAttribute('placeholder') || '';
            if (!label) {
              // Try preceding sibling text (floating labels, adjacent spans)
              const prev = input.previousElementSibling;
              if (prev && ['LABEL', 'SPAN', 'DIV', 'P'].includes(prev.tagName)) {
                const prevText = prev.textContent?.trim() || '';
                if (prevText.length > 0 && prevText.length < 50) label = prevText;
              }
            }
            if (!label) label = input.getAttribute('name') || '';
            
            const type = input.getAttribute('type') || input.tagName.toLowerCase();
            let value = '';
            if (type === 'password') {
              value = input.value ? '***' : 'empty';
            } else if (type === 'checkbox' || type === 'radio') {
              value = input.checked ? 'checked' : 'unchecked';
            } else if (input.tagName === 'SELECT') {
              value = input.options?.[input.selectedIndex]?.text || 'empty';
            } else {
              value = input.value ? String(input.value).substring(0, 30) : 'empty';
            }
            
            const displayLabel = label || input.getAttribute('name') || input.id || type;
            fields.push(displayLabel.substring(0, 30) + ' (' + type + ', ' + value + ')');
          });
          if (fields.length > 0) result.push('Forms: ' + fields.join(', '));
        }

        // Buttons
        if (includes.includes('buttons')) {
          const buttons = root.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
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
          root.querySelectorAll('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(el => navContainers.add(el));

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
          root.querySelectorAll('a[href]').forEach(a => {
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
          const imgs = root.querySelectorAll('img[alt]');
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
