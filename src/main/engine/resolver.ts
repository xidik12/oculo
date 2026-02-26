import { WebContents } from 'electron'

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
        const target = ${JSON.stringify(target)};
        const nth = target.nth || 0;
        
        function getUniqueSelector(el) {
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

        function findByText(text) {
          const lower = text.toLowerCase();
          // Phase 1: search interactive elements first (faster, more specific)
          const interactive = document.querySelectorAll('button, a, [role="button"], [role="link"], input[type="submit"], input[type="button"], label');
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
          const broader = document.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6, div, li, td, th');
          const fallback = [];
          broader.forEach(el => {
            if (!isVisible(el)) return;
            const elText = (el.textContent?.trim() || el.getAttribute('aria-label') || '').toLowerCase();
            if (elText === lower || elText.includes(lower)) {
              fallback.push(el);
            }
          });
          sortMatches(fallback);
          return fallback[nth] || null;
        }

        function findByRole(role, name) {
          const roleMap = {
            'button': 'button, [role="button"], input[type="submit"], input[type="button"]',
            'link': 'a, [role="link"]',
            'textbox': 'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea, [role="textbox"]',
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
          const candidates = document.querySelectorAll(selectorStr);
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
          const labels = document.querySelectorAll('label');
          for (const lbl of labels) {
            if ((lbl.textContent?.trim() || '').toLowerCase().includes(lower)) {
              const forId = lbl.getAttribute('for');
              if (forId) {
                const target = document.getElementById(forId);
                if (target && isVisible(target)) return target;
              }
              // Wrapped input
              const input = lbl.querySelector('input, textarea, select');
              if (input && isVisible(input)) return input;
            }
          }
          // Try aria-label
          const ariaEls = document.querySelectorAll('[aria-label]');
          for (const el of ariaEls) {
            if (el.getAttribute('aria-label').toLowerCase().includes(lower) && isVisible(el)) return el;
          }
          return null;
        }

        function findByPlaceholder(placeholder) {
          const lower = placeholder.toLowerCase();
          const inputs = document.querySelectorAll('input[placeholder], textarea[placeholder]');
          for (const input of inputs) {
            if (input.getAttribute('placeholder').toLowerCase().includes(lower) && isVisible(input)) return input;
          }
          return null;
        }

        function getSimilarElements(target) {
          // Find similar interactive elements to suggest
          const interactive = document.querySelectorAll('button, a, input[type="submit"], [role="button"]');
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
        const el = document.querySelector(${JSON.stringify(resolved.selector)});
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

    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(resolved.selector)});
        if (!el) return 'Element disappeared';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        if (${clear ? 'true' : 'false'}) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Set value and dispatch events for React/Vue compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        const newValue = ${clear ? 'true' : 'false'} ? ${JSON.stringify(text)} : (el.value || '') + ${JSON.stringify(text)};
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, newValue);
        } else {
          el.value = newValue;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
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
        const el = document.querySelector(${JSON.stringify(resolved.selector)});
        if (!el || el.tagName !== 'SELECT') return 'Element is not a select dropdown';
        const lower = ${JSON.stringify(value.toLowerCase())};
        let found = false;
        for (const opt of el.options) {
          if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
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
