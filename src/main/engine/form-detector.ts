import { WebContents } from 'electron'
import { FormDescription } from '../../shared/types'
import { deepQuerySnippet } from './deep-query'

export class FormDetector {
  async detectForms(webContents: WebContents): Promise<FormDescription[]> {
    const script = `
      (function() {
        ${deepQuerySnippet()}
        function getLabel(input) {
          if (input.id) {
            const lbl = querySelectorDeep(document, 'label[for="' + CSS.escape(input.id) + '"]');
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
    // Wait for page readiness (React hydration, lazy loading)
    try {
      await webContents.executeJavaScript(`
        new Promise(resolve => {
          if (document.readyState === 'complete') return resolve(true);
          window.addEventListener('load', () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 3000);
        })
      `)
      // Brief pause for framework mounting after load event
      await new Promise(r => setTimeout(r, 200))
    } catch { /* proceed anyway */ }

    // Hydration-ready check: verify inputs are interactive before filling
    const fieldLabels = Object.keys(fields)
    if (fieldLabels.length > 0) {
      let readyCheckPassed = false
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          readyCheckPassed = await webContents.executeJavaScript(`
            (function() {
              if (document.readyState !== 'complete') return false;
              ${deepQuerySnippet()}
              const labels = ${JSON.stringify(fieldLabels)};
              for (const label of labels) {
                const lower = label.toLowerCase();
                let el = null;
                // Quick search for matching input
                if (label.startsWith('#') || label.startsWith('.') || label.startsWith('[')) {
                  el = querySelectorDeep(document, label);
                }
                if (!el) {
                  const allLabels = querySelectorAllDeep(document, 'label');
                  for (const lbl of allLabels) {
                    if (lbl.textContent.trim().toLowerCase().includes(lower)) {
                      if (lbl.htmlFor) {
                        el = document.getElementById(lbl.htmlFor) || querySelectorDeep(document, '#' + CSS.escape(lbl.htmlFor));
                      }
                      if (!el) el = lbl.querySelector('input, textarea, select');
                      if (el) break;
                    }
                  }
                }
                if (!el) {
                  const placeholders = querySelectorAllDeep(document, 'input[placeholder], textarea[placeholder]');
                  for (const inp of placeholders) {
                    if (inp.placeholder.toLowerCase().includes(lower)) { el = inp; break; }
                  }
                }
                if (el && (el.disabled || el.readOnly)) return false;
              }
              return true;
            })()
          `)
          if (readyCheckPassed) break
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500))
      }
    }

    const script = `
      (function() {
        ${deepQuerySnippet()}
        const fields = ${JSON.stringify(fields)};
        let filled = 0;
        let total = Object.keys(fields).length;
        const errors = [];

        function findInput(label) {
          const lower = label.toLowerCase();
          
          // Try CSS selector directly (for unlabeled fields like "#field-id")
          if (label.startsWith('#') || label.startsWith('.') || label.startsWith('[')) {
            const direct = querySelectorDeep(document, label);
            if (direct) return direct;
          }
          // Try label[for] (deep query for Shadow DOM)
          const labels = querySelectorAllDeep(document, 'label');
          for (const lbl of labels) {
            if (lbl.textContent.trim().toLowerCase().includes(lower)) {
              if (lbl.htmlFor) {
                const input = document.getElementById(lbl.htmlFor) || querySelectorDeep(document, '#' + CSS.escape(lbl.htmlFor));
                if (input) return input;
              }
              const input = lbl.querySelector('input, textarea, select');
              if (input) return input;
            }
          }
          // Try placeholder
          const inputs = querySelectorAllDeep(document, 'input[placeholder], textarea[placeholder]');
          for (const input of inputs) {
            if (input.placeholder.toLowerCase().includes(lower)) return input;
          }
          // Try aria-label
          const ariaEls = querySelectorAllDeep(document, '[aria-label]');
          for (const el of ariaEls) {
            if (el.getAttribute('aria-label').toLowerCase().includes(lower)) return el;
          }
          // Try aria-labelledby
          const labelledByEls = querySelectorAllDeep(document, '[aria-labelledby]');
          for (const el of labelledByEls) {
            const refId = el.getAttribute('aria-labelledby');
            const refEl = document.getElementById(refId);
            if (refEl && (refEl.textContent?.trim() || '').toLowerCase().includes(lower)) return el;
          }
          // Try data-placeholder / aria-placeholder (contenteditable fields like DraftJS)
          const cePlaceholders = querySelectorAllDeep(document, '[data-placeholder], [aria-placeholder]');
          for (const el of cePlaceholders) {
            const ph = (el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '').toLowerCase();
            if (ph.includes(lower)) return el;
          }
          // Try name attribute
          const namedEls = querySelectorAllDeep(document, '[name]');
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
                // Use native setter for React/Vue compatibility
                const nativeSelectSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLSelectElement.prototype, 'value'
                )?.set;
                if (nativeSelectSetter) nativeSelectSetter.call(el, opt.value);
                else el.value = opt.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
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

        // Submit if requested — multi-strategy button search with verification
        let submitResult = '';
        const submitText = ${JSON.stringify(submit)};
        if (submitText) {
          const btnText = typeof submitText === 'string' ? submitText : null;
          let btn = null;
          let lastFilledInput = null;

          // Track the last filled input for proximity search
          for (const [label] of Object.entries(fields)) {
            const inp = findInput(label);
            if (inp) lastFilledInput = inp;
          }

          // Strategy 1: Look for submit button inside the closest <form> ancestor
          if (lastFilledInput) {
            const formAncestor = lastFilledInput.closest('form');
            if (formAncestor) {
              const formBtns = formAncestor.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])');
              for (const b of formBtns) {
                if (b.offsetParent === null) continue;
                const bText = (b.textContent?.trim() || b.value || b.getAttribute('aria-label') || '').toLowerCase();
                if (btnText) {
                  if (bText.includes(btnText.toLowerCase())) { btn = b; break; }
                } else {
                  btn = b; break;
                }
              }
            }
          }

          // Strategy 2: Look inside closest modal/dialog ancestor
          if (!btn && lastFilledInput) {
            const modalAncestor = lastFilledInput.closest('.modal, [role="dialog"], dialog, .modal-content, [role="alertdialog"]');
            if (modalAncestor) {
              const modalBtns = modalAncestor.querySelectorAll('button, input[type="submit"], [role="button"], a.btn, a[role="button"]');
              for (const b of modalBtns) {
                if (b.offsetParent === null && !b.closest('[role="dialog"], dialog')) continue;
                const bText = (b.textContent?.trim() || b.value || b.getAttribute('aria-label') || '').toLowerCase();
                if (btnText) {
                  if (bText.includes(btnText.toLowerCase())) { btn = b; break; }
                } else {
                  if (b.type === 'submit' || ['submit', 'save', 'create', 'add', 'ok', 'confirm', 'send', 'done', 'apply', 'update'].some(w => bText === w || bText.startsWith(w + ' '))) {
                    btn = b; break;
                  }
                }
              }
            }
          }

          // Strategy 3: Search visible modals/dialogs on page, then full document
          if (!btn) {
            const searchContexts = [];
            const visibleModals = document.querySelectorAll(
              '[role="dialog"], [role="alertdialog"], dialog[open], .modal.show, .modal.active, ' +
              '[class*="modal"][class*="open"], [class*="modal"][class*="show"], [class*="modal"][class*="visible"]'
            );
            visibleModals.forEach(m => {
              if (m.offsetParent !== null || m.closest('[role="dialog"]')) searchContexts.push(m);
            });
            searchContexts.push(document);

            for (const ctx of searchContexts) {
              if (btn) break;
              const buttons = ctx.querySelectorAll('button, input[type="submit"], [role="button"], a.btn, a[role="button"]');
              for (const b of buttons) {
                if (b.offsetParent === null && !b.closest('[role="dialog"], dialog')) continue;
                const bText = (b.textContent?.trim() || b.value || b.getAttribute('aria-label') || '').toLowerCase();
                if (btnText) {
                  if (bText.includes(btnText.toLowerCase())) { btn = b; break; }
                } else {
                  if (b.type === 'submit' || ['submit', 'save', 'create', 'add', 'ok', 'confirm', 'send', 'done', 'apply', 'update'].some(w => bText === w || bText.startsWith(w + ' '))) {
                    btn = b; break;
                  }
                }
              }
            }
          }

          // Strategy 4: Buttons with common submit text near the last filled field
          if (!btn && !btnText && lastFilledInput) {
            const commonTexts = ['submit', 'create', 'save', 'ok', 'confirm', 'apply', 'done', 'add'];
            const allBtns = document.querySelectorAll('button, input[type="submit"], [role="button"]');
            let bestBtn = null;
            let bestDist = Infinity;
            const inputRect = lastFilledInput.getBoundingClientRect();
            for (const b of allBtns) {
              if (b.offsetParent === null) continue;
              const bText = (b.textContent?.trim() || b.value || '').toLowerCase();
              if (commonTexts.some(w => bText === w || bText.startsWith(w + ' '))) {
                const bRect = b.getBoundingClientRect();
                const dist = Math.abs(bRect.top - inputRect.bottom) + Math.abs(bRect.left - inputRect.left);
                if (dist < bestDist) { bestDist = dist; bestBtn = b; }
              }
            }
            if (bestBtn) btn = bestBtn;
          }

          if (btn) {
            // Capture pre-click state for verification
            const preClickModal = btn.closest('.modal, [role="dialog"], dialog, .modal-content, [role="alertdialog"]');
            const preClickBtnId = btn.id || null;
            const preClickBtnText = btn.textContent?.trim() || '';

            btn.scrollIntoView({ block: 'center' });
            btn.click();
            // Mark for post-click verification by the outer handler
            submitResult = ' [submit-pending:' + (btnText || preClickBtnText || 'submit') + ']';
          } else {
            const searchLabel = btnText || 'submit';
            submitResult = ' [submit failed \\u2014 no button matching "' + searchLabel + '" found]';
          }
        }

        const errorMsg = errors.length > 0 ? ' (not found: ' + errors.join(', ') + ')' : '';
        return 'Filled ' + filled + '/' + total + ' fields.' + errorMsg + submitResult;
      })()
    `
    try {
      const result = await webContents.executeJavaScript(script)
      if (submit && result.includes('[submit-pending:')) {
        // Wait for submit action to take effect
        await new Promise(r => setTimeout(r, 500))

        // Verify submit outcome
        const submitOutcome = await webContents.executeJavaScript(`
          (function() {
            // Check if any modal/dialog/form is still visible
            const modals = document.querySelectorAll(
              '[role="dialog"], [role="alertdialog"], dialog[open], .modal.show, .modal.active, ' +
              '[class*="modal"][class*="open"], [class*="modal"][class*="show"], [class*="modal"][class*="visible"]'
            );
            let modalStillVisible = false;
            modals.forEach(m => {
              if (m.offsetParent !== null || m.closest('[role="dialog"]')) modalStillVisible = true;
            });
            // Also check if forms with visible inputs are still present
            const forms = document.querySelectorAll('form');
            let formStillVisible = false;
            forms.forEach(f => {
              if (f.offsetParent !== null && f.querySelectorAll('input:not([type="hidden"]), textarea, select').length > 0) {
                formStillVisible = true;
              }
            });
            return { modalStillVisible, formStillVisible };
          })()
        `)

        const title = await webContents.executeJavaScript('document.title')
        const url = webContents.getURL()

        // Replace the pending marker with the actual outcome
        let finalResult = result
        if (submitOutcome.modalStillVisible || submitOutcome.formStillVisible) {
          finalResult = finalResult.replace(/\s*\[submit-pending:[^\]]*\]/, ' [submitted — but form still visible, may need manual verification]')
        } else {
          finalResult = finalResult.replace(/\s*\[submit-pending:[^\]]*\]/, ' [submitted]')
        }

        return finalResult + ` Page: ${title} | ${url}`
      }
      // If submit was requested but button was not found (no pending marker), just return result
      if (submit) {
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
