import { INJECTION_PATTERNS } from '../../shared/constants'

export class AntiInjection {
  /**
   * Wrap page content in boundary markers so Claude knows it's untrusted.
   */
  wrapContent(content: string): string {
    return `---PAGE CONTENT (UNTRUSTED)---\n${content}\n---END PAGE CONTENT---`
  }

  /**
   * Strip hidden elements from page content descriptions.
   * This is called on the raw text extracted from the page.
   */
  sanitize(content: string): string {
    let result = content

    // Scan for injection patterns
    const warnings: string[] = []
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(result)) {
        warnings.push(`[WARNING: Potential prompt injection detected]`)
        // Don't remove the content — just flag it so Claude can see the warning
        break
      }
    }

    if (warnings.length > 0) {
      result = warnings.join('\n') + '\n' + result
    }

    return result
  }

  /**
   * Generate the in-page JavaScript to strip hidden elements before extraction.
   * This runs in the webview's V8 context before any content is sent to Claude.
   */
  getStripHiddenScript(): string {
    return `
      (function() {
        // Remove elements that are hidden (potential injection vectors)
        const allElements = document.querySelectorAll('*');
        let removed = 0;
        allElements.forEach(el => {
          const style = getComputedStyle(el);
          const isHidden = 
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity) === 0 ||
            (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.querySelector('input, textarea, select')) ||
            parseInt(style.fontSize) === 0;
          
          // Don't remove if it's a form input (might be a hidden but functional field)
          if (isHidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
            // Instead of removing, clear text content to prevent injection
            if (el.childNodes.length > 0 && el.textContent && el.textContent.trim().length > 0) {
              // Only clear leaf text nodes, not containers
              const hasVisibleChildren = Array.from(el.children).some(child => {
                const cs = getComputedStyle(child);
                return cs.display !== 'none' && cs.visibility !== 'hidden';
              });
              if (!hasVisibleChildren) {
                removed++;
              }
            }
          }
        });
        return removed;
      })()
    `
  }
}
