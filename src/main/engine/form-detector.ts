import { WebContents } from 'electron'
import { FormDescription } from '../../shared/types'

export class FormDetector {
  async detectForms(webContents: WebContents): Promise<FormDescription[]> {
    const script = `
      (function() {
        function getLabel(input) {
          if (input.id) {
            const lbl = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
            if (lbl) return lbl.textContent.trim();
          }
          const parent = input.closest('label');
          if (parent) {
            const clone = parent.cloneNode(true);
            clone.querySelectorAll('input, textarea, select').forEach(el => el.remove());
            return clone.textContent.trim();
          }
          return input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.getAttribute('name') || '';
        }

        function getType(input) {
          if (input.tagName === 'TEXTAREA') return 'textarea';
          if (input.tagName === 'SELECT') return 'select';
          return input.getAttribute('type') || 'text';
        }

        // Collect all inputs, even those not in <form> tags
        const formEls = document.querySelectorAll('form');
        const forms = [];

        function processInputs(container, formId, formAction) {
          const inputs = container.querySelectorAll('input:not([type="hidden"]), textarea, select');
          const fields = [];
          let submitBtn = null;
          
          inputs.forEach(input => {
            if (input.offsetParent === null) return; // skip invisible
            const type = getType(input);
            const label = getLabel(input);
            if (!label) return;

            const field = {
              label: label.substring(0, 50),
              type: type,
              value: type === 'password' ? '***' : (input.value || '').substring(0, 30),
              placeholder: input.getAttribute('placeholder') || undefined,
              required: input.required || input.getAttribute('aria-required') === 'true',
              checked: type === 'checkbox' || type === 'radio' ? input.checked : undefined
            };

            if (type === 'select') {
              field.options = Array.from(input.options || []).map(o => o.text).slice(0, 20);
            }

            fields.push(field);
          });

          // Find submit button
          const btns = container.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])');
          btns.forEach(btn => {
            if (btn.offsetParent !== null) {
              submitBtn = btn.textContent?.trim() || btn.getAttribute('value') || 'Submit';
            }
          });

          if (fields.length > 0) {
            forms.push({
              id: formId || undefined,
              action: formAction || undefined,
              fields: fields,
              submitButton: submitBtn || undefined
            });
          }
        }

        if (formEls.length > 0) {
          formEls.forEach(form => {
            processInputs(form, form.id, form.action);
          });
        } else {
          // SPA - no form tags, look at body
          processInputs(document.body, null, null);
        }

        return forms;
      })()
    `
    try {
      return await webContents.executeJavaScript(script)
    } catch {
      return []
    }
  }

  /**
   * Fill form fields by matching labels
   */
  async fillForm(
    webContents: WebContents,
    fields: Record<string, string | boolean>,
    submit?: boolean | string
  ): Promise<string> {
    const script = `
      (function() {
        const fields = ${JSON.stringify(fields)};
        let filled = 0;
        let total = Object.keys(fields).length;
        const errors = [];

        function findInput(label) {
          const lower = label.toLowerCase();
          
          // Try label[for] 
          const labels = document.querySelectorAll('label');
          for (const lbl of labels) {
            if (lbl.textContent.trim().toLowerCase().includes(lower)) {
              if (lbl.htmlFor) {
                const input = document.getElementById(lbl.htmlFor);
                if (input) return input;
              }
              const input = lbl.querySelector('input, textarea, select');
              if (input) return input;
            }
          }
          // Try placeholder
          const inputs = document.querySelectorAll('input[placeholder], textarea[placeholder]');
          for (const input of inputs) {
            if (input.placeholder.toLowerCase().includes(lower)) return input;
          }
          // Try aria-label
          const ariaEls = document.querySelectorAll('[aria-label]');
          for (const el of ariaEls) {
            if (el.getAttribute('aria-label').toLowerCase().includes(lower)) return el;
          }
          // Try data-placeholder / aria-placeholder (contenteditable fields like DraftJS)
          const cePlaceholders = document.querySelectorAll('[data-placeholder], [aria-placeholder]');
          for (const el of cePlaceholders) {
            const ph = (el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '').toLowerCase();
            if (ph.includes(lower)) return el;
          }
          // Try name attribute
          const namedEls = document.querySelectorAll('[name]');
          for (const el of namedEls) {
            if (el.name.toLowerCase().includes(lower)) return el;
          }
          return null;
        }

        function setValue(el, value) {
          if (typeof value === 'boolean') {
            // Checkbox
            if (el.checked !== value) el.click();
            return true;
          }
          if (el.tagName === 'SELECT') {
            const lower = value.toLowerCase();
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            return false;
          }
          // Contenteditable (DraftJS, ProseMirror, etc.) — 3-step fallback chain
          if (el.contentEditable === 'true' || el.getAttribute('role') === 'textbox') {
            el.focus();
            // Clear existing content
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);

            // Strategy 1: Clipboard paste simulation (most reliable for React/DraftJS)
            try {
              const dt = new DataTransfer();
              dt.setData('text/plain', value);
              const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
              el.dispatchEvent(pasteEvent);
              if (el.textContent && el.textContent.includes(value)) return true;
            } catch(e) { /* fallback */ }

            // Strategy 2: InputEvent with insertText (works for some React apps)
            try {
              el.textContent = '';
              el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: value, bubbles: true, cancelable: true }));
              el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: value, bubbles: true }));
              if (el.textContent && el.textContent.includes(value)) return true;
            } catch(e) { /* fallback */ }

            // Strategy 3: execCommand fallback (works for simple contenteditable)
            document.execCommand('insertText', false, value);
            return true;
          }
          // Text input
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        for (const [label, value] of Object.entries(fields)) {
          const input = findInput(label);
          if (!input) {
            errors.push(label);
            continue;
          }
          if (setValue(input, value)) filled++;
          else errors.push(label);
        }

        // Submit if requested
        let submitResult = '';
        const submitText = ${JSON.stringify(submit)};
        if (submitText) {
          const btnText = typeof submitText === 'string' ? submitText : null;
          let btn = null;
          if (btnText) {
            const buttons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
            for (const b of buttons) {
              const text = (b.textContent?.trim() || b.value || '').toLowerCase();
              if (text.includes(btnText.toLowerCase())) { btn = b; break; }
            }
          } else {
            btn = document.querySelector('button[type="submit"], input[type="submit"]');
            if (!btn) btn = document.querySelector('form button:not([type="button"])');
          }
          if (btn) {
            btn.click();
            submitResult = ' Submitted.';
          } else {
            submitResult = ' Submit button not found.';
          }
        }

        const errorMsg = errors.length > 0 ? ' (not found: ' + errors.join(', ') + ')' : '';
        return 'Filled ' + filled + '/' + total + ' fields.' + errorMsg + submitResult;
      })()
    `
    try {
      const result = await webContents.executeJavaScript(script)
      if (submit) {
        await new Promise(r => setTimeout(r, 1000))
        const title = await webContents.executeJavaScript('document.title')
        const url = webContents.getURL()
        return result + ` Page: ${title} | ${url}`
      }
      return result
    } catch (err) {
      return `Fill error: ${(err as Error).message}`
    }
  }
}
