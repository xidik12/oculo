import { WebContents } from 'electron'
import { deepQuerySnippet } from './deep-query'

export interface ResolveTarget {
  text?: string
  role?: string
  name?: string
  label?: string
  placeholder?: string
  selector?: string
  nth?: number
}

/**
 * Resolves elements by semantic targeting (text, role, label, placeholder).
 * All resolution happens in-page via executeJavaScript — zero tokens.
 * Returns a CSS selector path that can be used for subsequent actions.
 */
export class ElementResolver {
  /**
   * Resolve an element and return a unique selector for it.
   * Tries multiple strategies in priority order.
   */
  async resolve(webContents: WebContents, target: ResolveTarget): Promise<{ found: boolean; selector?: string; error?: string }> {
    const script = `
      (function() {
        ${deepQuerySnippet()}
        const target = ${JSON.stringify(target)};
        const nth = target.nth || 0;

        function getUniqueSelector(el) {
          // Shadow DOM element — tag with unique ref for cross-call re-finding
          if (el.getRootNode() !== document) {
            const ref = 'oculo-' + Math.random().toString(36).slice(2, 8);
            el.setAttribute('data-oculo-ref', ref);
            return '[data-oculo-ref="' + ref + '"]';
          }
          if (el.id) return '#' + CSS.escape(el.id);
          const path = [];
          let current = el;
          while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
              path.unshift('#' + CSS.escape(current.id));
              break;
            }
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += ':nth-of-type(' + index + ')';
              }
            }
            path.unshift(selector);
            current = current.parentElement;
          }
          return path.join(' > ');
        }

        function isVisible(el) {
          if (!el) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
        }

        function fuzzyMatch(a, b) {
          a = a.toLowerCase(); b = b.toLowerCase();
          if (a === b || a.includes(b) || b.includes(a)) return true;
          var ta = a.split(/[\\s\\-_\\/]+/).filter(function(t) { return t.length > 2; });
          var tb = b.split(/[\\s\\-_\\/]+/).filter(function(t) { return t.length > 2; });
          if (!ta.length || !tb.length) return false;
          var m = 0; for (var i = 0; i < ta.length; i++) { for (var j = 0; j < tb.length; j++) { if (ta[i] === tb[j]) m++; } }
          return m >= Math.min(ta.length, tb.length) * 0.5;
        }

        function findByText(text) {
          const lower = text.toLowerCase();
          // Phase 1: search interactive elements first (faster, more specific)
          const interactive = querySelectorAllDeep(document, 'button, a, [role="button"], [role="link"], input[type="submit"], input[type="button"], label');
          const matches = [];
          interactive.forEach(el => {
            if (!isVisible(el)) return;
            const elText = (el.textContent?.trim() || el.getAttribute('value') || el.getAttribute('aria-label') || '').toLowerCase();
            if (elText === lower || elText.includes(lower)) {
              matches.push(el);
            }
          });
          // Sort: exact matches first, then shortest text (most specific)
          const sortMatches = (arr) => {
            arr.sort((a, b) => {
              const aText = (a.textContent?.trim() || '').toLowerCase();
              const bText = (b.textContent?.trim() || '').toLowerCase();
              if (aText === lower && bText !== lower) return -1;
              if (bText === lower && aText !== lower) return 1;
              return aText.length - bText.length;
            });
          };
          sortMatches(matches);
          if (matches[nth]) return matches[nth];

          // Phase 2: broader fallback if no interactive match
          const broader = querySelectorAllDeep(document, 'span, p, h1, h2, h3, h4, h5, h6, div, li, td, th');
          const fallback = [];
          broader.forEach(el => {
            if (!isVisible(el)) return;
            const elText = (el.getAttribute('data-placeholder') || el.textContent?.trim() || el.getAttribute('aria-label') || '').toLowerCase();
            if (elText === lower || elText.includes(lower)) {
              fallback.push(el);
            }
          });
          sortMatches(fallback);
          if (fallback[nth]) return fallback[nth];

          // Phase 3: fuzzy token-overlap matching (e.g. "Sign Up" matches "Sign Up Now")
          const fuzzyResults = [];
          interactive.forEach(el => {
            if (!isVisible(el)) return;
            const elText = el.textContent?.trim() || el.getAttribute('value') || el.getAttribute('aria-label') || '';
            if (fuzzyMatch(elText, text)) fuzzyResults.push(el);
          });
          sortMatches(fuzzyResults);
          if (fuzzyResults[nth]) return fuzzyResults[nth];

          // Phase 3b: fuzzy on broader elements
          const fuzzyBroader = [];
          broader.forEach(el => {
            if (!isVisible(el)) return;
            const elText = el.getAttribute('data-placeholder') || el.textContent?.trim() || el.getAttribute('aria-label') || '';
            if (fuzzyMatch(elText, text)) fuzzyBroader.push(el);
          });
          sortMatches(fuzzyBroader);
          return fuzzyBroader[nth] || null;
        }

        function findByRole(role, name) {
          const roleMap = {
            'button': 'button, [role="button"], input[type="submit"], input[type="button"]',
            'link': 'a, [role="link"]',
            'textbox': 'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea, [role="textbox"], [contenteditable="true"]',
            'checkbox': 'input[type="checkbox"], [role="checkbox"]',
            'radio': 'input[type="radio"], [role="radio"]',
            'combobox': 'select, [role="combobox"], [role="listbox"]',
            'heading': 'h1, h2, h3, h4, h5, h6, [role="heading"]',
            'img': 'img, [role="img"]',
            'list': 'ul, ol, [role="list"]',
            'listitem': 'li, [role="listitem"]',
            'navigation': 'nav, [role="navigation"]',
            'search': '[role="search"], input[type="search"]',
            'tab': '[role="tab"]',
            'table': 'table, [role="table"]',
            'row': 'tr, [role="row"]'
          };
          const selectorStr = roleMap[role] || '[role="' + role + '"]';
          const candidates = querySelectorAllDeep(document, selectorStr);
          const matches = [];
          candidates.forEach(el => {
            if (!isVisible(el)) return;
            if (name) {
              const elName = (el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('value') || el.getAttribute('alt') || '').toLowerCase();
              if (elName.includes(name.toLowerCase())) matches.push(el);
            } else {
              matches.push(el);
            }
          });
          return matches[nth] || null;
        }

        function findByLabel(label) {
          const lower = label.toLowerCase();
          // Try label[for] association
          const labels = querySelectorAllDeep(document, 'label');
          for (const lbl of labels) {
            if ((lbl.textContent?.trim() || '').toLowerCase().includes(lower)) {
              const forId = lbl.getAttribute('for');
              if (forId) {
                const target = document.getElementById(forId) || querySelectorDeep(document, '#' + CSS.escape(forId));
                if (target && isVisible(target)) return target;
              }
              // Wrapped input
              const input = lbl.querySelector('input, textarea, select');
              if (input && isVisible(input)) return input;
            }
          }
          // Try aria-label
          const ariaEls = querySelectorAllDeep(document, '[aria-label]');
          for (const el of ariaEls) {
            if (el.getAttribute('aria-label').toLowerCase().includes(lower) && isVisible(el)) return el;
          }
          return null;
        }

        function findByPlaceholder(placeholder) {
          const lower = placeholder.toLowerCase();
          const inputs = querySelectorAllDeep(document, 'input[placeholder], textarea[placeholder]');
          for (const input of inputs) {
            if (input.getAttribute('placeholder').toLowerCase().includes(lower) && isVisible(input)) return input;
          }
          // Contenteditable elements with data-placeholder or aria-placeholder
          const ceInputs = querySelectorAllDeep(document, '[data-placeholder], [aria-placeholder]');
          for (const el of ceInputs) {
            const ph = (el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '').toLowerCase();
            if (ph.includes(lower) && isVisible(el)) return el;
          }
          return null;
        }

        function getSimilarElements(target) {
          // Find similar interactive elements to suggest
          const interactive = querySelectorAllDeep(document, 'button, a, input[type="submit"], [role="button"]');
          const suggestions = [];
          interactive.forEach(el => {
            if (!isVisible(el)) return;
            const text = (el.textContent?.trim() || el.getAttribute('value') || '').substring(0, 30);
            if (text && text.length > 1) suggestions.push(text);
          });
          return [...new Set(suggestions)].slice(0, 5);
        }

        let element = null;
        let strategy = '';

        // Try each strategy in priority order
        if (target.selector) {
          element = document.querySelector(target.selector);
          strategy = 'selector';
        }
        if (!element && target.label) {
          element = findByLabel(target.label);
          strategy = 'label';
        }
        if (!element && target.placeholder) {
          element = findByPlaceholder(target.placeholder);
          strategy = 'placeholder';
        }
        if (!element && target.role) {
          element = findByRole(target.role, target.name || target.text);
          strategy = 'role';
        }
        if (!element && target.text) {
          element = findByText(target.text);
          strategy = 'text';
        }

        if (element) {
          return { found: true, selector: getUniqueSelector(element), strategy: strategy };
        } else {
          const targetDesc = target.text || target.label || target.placeholder || target.role || target.selector || 'unknown';
          const similar = getSimilarElements(target);
          const hint = similar.length > 0 ? ' Similar: [' + similar.join('] [') + ']' : '';
          return { found: false, error: 'Could not find "' + targetDesc + '".' + hint };
        }
      })()
    `

    try {
      return await webContents.executeJavaScript(script)
    } catch (err) {
      return { found: false, error: `Resolver error: ${(err as Error).message}` }
    }
  }

  /**
   * Click an element by target
   */
  async click(webContents: WebContents, target: ResolveTarget): Promise<string> {
    const resolved = await this.resolve(webContents, target)
    if (!resolved.found || !resolved.selector) {
      return resolved.error || 'Element not found'
    }

    const script = `
      (function() {
        ${deepQuerySnippet()}
        const el = document.querySelector(${JSON.stringify(resolved.selector)}) || querySelectorDeep(document, ${JSON.stringify(resolved.selector)});
        if (!el) return 'Element disappeared';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return 'ok';
      })()
    `
    const result = await webContents.executeJavaScript(script)
    if (result !== 'ok') return result

    // Wait a moment for any navigation/DOM update
    await new Promise(r => setTimeout(r, 500))
    
    const title = await webContents.executeJavaScript('document.title')
    const url = webContents.getURL()
    const targetDesc = target.text || target.label || target.role || target.selector || ''
    return `Clicked "${targetDesc}". Page: ${title} | ${url}`
  }

  /**
   * Type into an element by target
   */
  async type(webContents: WebContents, target: ResolveTarget, text: string, clear?: boolean): Promise<string> {
    const resolved = await this.resolve(webContents, target)
    if (!resolved.found || !resolved.selector) {
      return resolved.error || 'Element not found'
    }

    // Base64-encode text to prevent $$ or ${} from being shell/template-interpolated
    const textB64 = Buffer.from(text, 'utf-8').toString('base64')

    const script = `
      (function() {
        ${deepQuerySnippet()}
        const text = decodeURIComponent(escape(atob("${textB64}")));
        const el = document.querySelector(${JSON.stringify(resolved.selector)}) || querySelectorDeep(document, ${JSON.stringify(resolved.selector)});
        if (!el) return 'Element disappeared';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        const isContentEditable = el.contentEditable === 'true' || el.getAttribute('role') === 'textbox';
        if (isContentEditable) {
          // Detect Lexical editor — rejects programmatic input
          if (el.hasAttribute('data-lexical-editor') || el.__lexicalEditor) {
            return 'Warning: Target is a Lexical editor which rejects programmatic input. Use evaluate() with editor.parseEditorState() + editor.setEditorState() instead. See: el.__lexicalEditor';
          }
          if (${clear ? 'true' : 'false'}) {
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
          }
          document.execCommand('insertText', false, text);
          // Verify content was actually inserted for contenteditable
          const innerText = el.innerText || el.textContent || '';
          if (!innerText.includes(text.substring(0, Math.min(10, text.length)))) {
            return 'Warning: Content may not have been inserted. The contenteditable element may reject programmatic input. Try evaluate() with direct DOM manipulation instead.';
          }
          return 'ok';
        }
        // Use native setter to trigger React onChange
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (${clear ? 'true' : 'false'}) {
          if (nativeSetter) nativeSetter.call(el, '');
          else el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        const newValue = ${clear ? 'true' : 'false'} ? text : (el.value || '') + text;
        if (nativeSetter) {
          nativeSetter.call(el, newValue);
        } else {
          el.value = newValue;
        }
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return 'ok';
      })()
    `
    const result = await webContents.executeJavaScript(script)
    if (result !== 'ok') return result

    const targetDesc = target.text || target.label || target.placeholder || ''
    return `Typed "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}" into "${targetDesc}"`
  }

  /**
   * Select a value in a dropdown by target
   */
  async select(webContents: WebContents, target: ResolveTarget, value: string): Promise<string> {
    const resolved = await this.resolve(webContents, target)
    if (!resolved.found || !resolved.selector) {
      return resolved.error || 'Element not found'
    }

    const script = `
      (function() {
        ${deepQuerySnippet()}
        const el = document.querySelector(${JSON.stringify(resolved.selector)}) || querySelectorDeep(document, ${JSON.stringify(resolved.selector)});
        if (!el || el.tagName !== 'SELECT') return 'Element is not a select dropdown';
        const lower = ${JSON.stringify(value.toLowerCase())};
        let found = false;
        for (const opt of el.options) {
          if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
            // Use native setter for React/Vue compatibility
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLSelectElement.prototype, 'value'
            )?.set;
            if (nativeSetter) nativeSetter.call(el, opt.value);
            else el.value = opt.value;
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            found = true;
            break;
          }
        }
        return found ? 'ok' : 'Option "' + ${JSON.stringify(value)} + '" not found in dropdown';
      })()
    `
    return await webContents.executeJavaScript(script)
  }
}
