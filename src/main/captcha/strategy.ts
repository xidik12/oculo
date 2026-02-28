import { WebContents } from 'electron'
import { CaptchaType } from '../../shared/types'
import { CaptchaDetector } from './detector'
import { AudioSolver } from './audio-solver'
import { TextSolver } from './text-solver'
import { SliderSolver } from './slider-solver'

export class CaptchaStrategy {
  private detector: CaptchaDetector
  private audioSolver: AudioSolver
  private textSolver: TextSolver
  private sliderSolver: SliderSolver

  constructor() {
    this.detector = new CaptchaDetector()
    this.audioSolver = new AudioSolver()
    this.textSolver = new TextSolver()
    this.sliderSolver = new SliderSolver()
  }

  /**
   * Attempt to solve any CAPTCHA on the page.
   * Tries strategies in order of cost (cheapest first).
   * Returns result description.
   */
  async solve(webContents: WebContents): Promise<string> {
    const detection = await this.detector.detect(webContents)

    if (!detection.detected) {
      return 'No CAPTCHA detected'
    }

    console.log(`CAPTCHA detected: ${detection.type}`)

    switch (detection.type) {
      case 'recaptcha_v3':
      case 'turnstile':
        // Invisible CAPTCHAs pass automatically in a real browser
        return 'Invisible CAPTCHA — auto-passed (real browser)'

      case 'text':
      case 'math':
        return await this.textSolver.solve(webContents)

      case 'slider':
        return await this.sliderSolver.solve(webContents)

      case 'recaptcha_v2':
      case 'hcaptcha':
        // Try audio first (free), then fall back to notification
        try {
          const audioResult = await this.audioSolver.solve(webContents, detection.type)
          if (audioResult.success) return audioResult.message
        } catch (err) {
          console.log('Audio CAPTCHA solving failed:', err)
        }

        // Audio failed — suggest using solveCaptcha action for AI vision
        return 'CAPTCHA requires solving. Use act({action:"solveCaptcha"}) for AI vision-based solving, or solve manually in the browser.'

      case 'image':
        // Image CAPTCHAs — suggest AI vision solving
        return 'Image CAPTCHA detected. Use act({action:"solveCaptcha"}) for AI vision-based solving, or solve manually in the browser.'

      default:
        return `Unknown CAPTCHA type: ${detection.type}. Try act({action:"solveCaptcha"}) or solve manually.`
    }
  }

  /**
   * Attempt vision-based CAPTCHA solving by screenshotting the CAPTCHA region
   * and sending it to an AI provider for analysis.
   * Returns the AI's response text (the CAPTCHA answer).
   */
  async solveWithVision(
    webContents: WebContents,
    screenshotBase64: string
  ): Promise<{ answer: string | null; message: string }> {
    // This method is called from the renderer (App.tsx solveCaptcha action)
    // which provides the screenshot. The actual AI call is made from the renderer
    // since it has access to the AI provider configuration.
    // We just detect what kind of CAPTCHA it is and where the input field is.

    const detection = await this.detector.detect(webContents)

    if (!detection.detected) {
      return { answer: null, message: 'No CAPTCHA detected on page' }
    }

    // Find the CAPTCHA input field selector
    const inputInfo = await webContents.executeJavaScript(`
      (function() {
        // Text/image CAPTCHA input
        var inp = document.querySelector('#captcha-input, [name*=captcha i], input[placeholder*=captcha i], input[aria-label*=captcha i]');
        if (inp) return { selector: inp.id ? '#' + inp.id : (inp.name ? '[name="' + inp.name + '"]' : 'input[placeholder*=captcha i]'), type: 'text' };

        // reCAPTCHA audio response
        var audioInp = document.querySelector('#audio-response');
        if (audioInp) return { selector: '#audio-response', type: 'audio' };

        return { selector: null, type: '${detection.type}' };
      })()
    `)

    return {
      answer: null,
      message: JSON.stringify({
        type: detection.type,
        inputSelector: inputInfo?.selector,
        inputType: inputInfo?.type,
        hint: 'Screenshot provided — use AI to read the CAPTCHA text'
      })
    }
  }
}
