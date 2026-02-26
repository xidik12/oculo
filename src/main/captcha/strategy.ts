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
        
        // If audio fails, notify the user
        return 'CAPTCHA requires manual solving. Please solve it in the browser window.'

      case 'image':
        // Image CAPTCHAs — notify user
        return 'Image CAPTCHA detected. Please solve it in the browser window.'

      default:
        return `Unknown CAPTCHA type: ${detection.type}. Please solve it manually.`
    }
  }
}
