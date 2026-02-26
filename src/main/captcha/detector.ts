import { WebContents } from 'electron'
import { CaptchaType } from '../../shared/types'
import { CAPTCHA_SELECTORS } from '../../shared/constants'

export class CaptchaDetector {
  /**
   * Check if the current page has a CAPTCHA challenge
   */
  async detect(webContents: WebContents): Promise<{ detected: boolean; type: CaptchaType; selector?: string }> {
    const script = `
      (function() {
        const selectors = ${JSON.stringify(CAPTCHA_SELECTORS)};
        
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const src = el.getAttribute('src') || '';
            const cls = el.className || '';
            const id = el.id || '';
            
            if (src.includes('recaptcha') || cls.includes('g-recaptcha')) {
              // Check if it's v3 (invisible) or v2 (challenge)
              const badge = document.querySelector('.grecaptcha-badge');
              if (badge && !document.querySelector('iframe[src*="bframe"]')) {
                return { detected: true, type: 'recaptcha_v3', selector: sel };
              }
              return { detected: true, type: 'recaptcha_v2', selector: sel };
            }
            if (src.includes('hcaptcha') || cls.includes('h-captcha')) {
              return { detected: true, type: 'hcaptcha', selector: sel };
            }
            if (src.includes('turnstile') || cls.includes('cf-turnstile')) {
              return { detected: true, type: 'turnstile', selector: sel };
            }
            
            return { detected: true, type: 'unknown', selector: sel };
          }
        }
        
        // Check for text/image CAPTCHAs
        const captchaImg = document.querySelector('img[alt*="captcha" i], img[src*="captcha" i]');
        if (captchaImg) {
          return { detected: true, type: 'image', selector: 'img[alt*="captcha" i], img[src*="captcha" i]' };
        }
        
        const captchaInput = document.querySelector('input[name*="captcha" i], input[placeholder*="captcha" i]');
        if (captchaInput) {
          return { detected: true, type: 'text', selector: 'input[name*="captcha" i]' };
        }
        
        return { detected: false, type: 'unknown' };
      })()
    `

    try {
      return await webContents.executeJavaScript(script)
    } catch {
      return { detected: false, type: 'unknown' }
    }
  }

  /**
   * Set up a MutationObserver to watch for dynamically injected CAPTCHAs
   */
  async watchForCaptcha(webContents: WebContents, callback: (type: CaptchaType) => void): Promise<void> {
    // Inject observer script
    const script = `
      (function() {
        if (window.__oculoCaptchaObserver) return;
        
        const selectors = ${JSON.stringify(CAPTCHA_SELECTORS)};
        
        window.__oculoCaptchaObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== 1) continue;
              const el = node;
              for (const sel of selectors) {
                if (el.matches?.(sel) || el.querySelector?.(sel)) {
                  // Notify via custom event
                  window.dispatchEvent(new CustomEvent('oculo-captcha-detected', {
                    detail: { selector: sel }
                  }));
                  return;
                }
              }
            }
          }
        });
        
        window.__oculoCaptchaObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      })()
    `

    try {
      await webContents.executeJavaScript(script)
    } catch {
      // Page might not be ready yet
    }
  }
}
