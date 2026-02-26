import { WebContents } from 'electron'

export class TextSolver {
  async solve(webContents: WebContents): Promise<string> {
    const script = `
      (function() {
        // Try to find a text/math CAPTCHA
        const captchaImg = document.querySelector('img[alt*="captcha" i], img[src*="captcha" i]');
        const captchaText = document.querySelector('[class*="captcha" i] span, [class*="captcha" i] p, [id*="captcha" i] span');
        const captchaInput = document.querySelector('input[name*="captcha" i], input[placeholder*="captcha" i]');
        
        if (!captchaInput) {
          return { error: 'No CAPTCHA input field found' };
        }

        // Check for math CAPTCHA (e.g., "What is 3 + 5?")
        if (captchaText) {
          const text = captchaText.textContent?.trim() || '';
          // Try to parse as math expression
          const mathMatch = text.match(/(\\d+)\\s*([+\\-*/x])\\s*(\\d+)/);
          if (mathMatch) {
            const a = parseInt(mathMatch[1]);
            const op = mathMatch[2];
            const b = parseInt(mathMatch[3]);
            let answer = 0;
            switch (op) {
              case '+': answer = a + b; break;
              case '-': answer = a - b; break;
              case '*': case 'x': answer = a * b; break;
              case '/': answer = Math.round(a / b); break;
            }
            // Fill the answer
            captchaInput.value = String(answer);
            captchaInput.dispatchEvent(new Event('input', { bubbles: true }));
            captchaInput.dispatchEvent(new Event('change', { bubbles: true }));
            return { solved: true, answer: String(answer), type: 'math' };
          }
        }

        return { error: 'Could not solve text CAPTCHA automatically' };
      })()
    `

    try {
      const result = await webContents.executeJavaScript(script)
      if (result?.solved) {
        return `Math CAPTCHA solved: ${result.answer}`
      }
      return result?.error || 'Text CAPTCHA could not be solved automatically'
    } catch (err) {
      return `Text solver error: ${(err as Error).message}`
    }
  }
}
