import { WebContents, app } from 'electron'
import { CaptchaType } from '../../shared/types'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFileSync } from 'child_process'

/**
 * Audio CAPTCHA solver.
 * Strategy: Switch to audio challenge → download audio → transcribe locally or via AI → submit.
 * Uses CDP (Chrome DevTools Protocol) to interact with cross-origin CAPTCHA iframes.
 */
export class AudioSolver {
  async solve(
    webContents: WebContents,
    type: CaptchaType
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (type === 'recaptcha_v2') {
        return await this.solveRecaptchaAudio(webContents)
      } else if (type === 'hcaptcha') {
        return await this.solveHcaptchaAudio(webContents)
      }
      return { success: false, message: 'Audio solving not supported for this CAPTCHA type' }
    } catch (err) {
      return { success: false, message: `Audio solver error: ${(err as Error).message}` }
    }
  }

  /** Transcribe audio via whisper CLI or return null if unavailable */
  private async transcribeAudio(audioUrl: string): Promise<string | null> {
    try {
      const tempDir = path.join(app.getPath('temp'), 'oculo-captcha')
      fs.mkdirSync(tempDir, { recursive: true })
      const audioPath = path.join(tempDir, `captcha-${Date.now()}.mp3`)

      await new Promise<void>((resolve, reject) => {
        const client = audioUrl.startsWith('https') ? https : http
        const file = fs.createWriteStream(audioPath)
        client.get(audioUrl, (response) => {
          response.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      })

      // Try whisper.cpp CLI if available
      try {
        const whisperPaths = [
          '/usr/local/bin/whisper',
          '/opt/homebrew/bin/whisper',
          path.join(os.homedir(), '.local/bin/whisper'),
        ]
        let whisperBin: string | null = null
        for (const p of whisperPaths) {
          if (fs.existsSync(p)) { whisperBin = p; break }
        }

        if (whisperBin) {
          const output = execFileSync(whisperBin, [audioPath, '--language', 'en', '--output-txt'], {
            timeout: 30000,
            encoding: 'utf-8'
          })
          try { fs.unlinkSync(audioPath) } catch { /* ignore */ }
          return output.trim()
        }
      } catch { /* whisper not available */ }

      try { fs.unlinkSync(audioPath) } catch { /* ignore */ }
      return null
    } catch {
      return null
    }
  }

  /**
   * Use CDP to interact with cross-origin reCAPTCHA iframe.
   * Gets the frame tree, finds the CAPTCHA frame, and executes JS inside it.
   */
  private async executeInCaptchaFrame(
    webContents: WebContents,
    srcPattern: string,
    jsCode: string
  ): Promise<any> {
    try {
      // Attach debugger if not already attached
      if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach('1.3')
      }

      // Get the frame tree
      const { frameTree } = await webContents.debugger.sendCommand('Page.getFrameTree')

      // Find the CAPTCHA iframe frame
      const findFrame = (tree: any): string | null => {
        if (tree.frame?.url?.includes(srcPattern)) return tree.frame.id
        if (tree.childFrames) {
          for (const child of tree.childFrames) {
            const found = findFrame(child)
            if (found) return found
          }
        }
        return null
      }

      const frameId = findFrame(frameTree)
      if (!frameId) return null

      // Create an isolated world in the CAPTCHA frame to execute JS
      const { executionContextId } = await webContents.debugger.sendCommand(
        'Page.createIsolatedWorld',
        { frameId, worldName: 'oculo-captcha', grantUniveralAccess: true }
      )

      // Execute code in the frame context
      const result = await webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: jsCode,
        contextId: executionContextId,
        returnByValue: true,
        awaitPromise: true
      })

      return result?.result?.value
    } catch (err) {
      console.log('CDP CAPTCHA frame interaction failed:', err)
      return null
    }
  }

  private async solveRecaptchaAudio(webContents: WebContents): Promise<{ success: boolean; message: string }> {
    // Step 1: Click the reCAPTCHA checkbox via CDP
    const checkboxResult = await this.executeInCaptchaFrame(
      webContents,
      'recaptcha/api2/anchor',
      `(function() {
        var cb = document.querySelector('.recaptcha-checkbox-border, #recaptcha-anchor');
        if (cb) { cb.click(); return 'clicked'; }
        return 'not found';
      })()`
    )

    if (!checkboxResult || checkboxResult === 'not found') {
      // Fallback: try clicking the container in the main frame
      await webContents.executeJavaScript(`
        (function() {
          var container = document.querySelector('.g-recaptcha, [data-sitekey]');
          if (container) container.click();
        })()
      `)
    }

    await new Promise(r => setTimeout(r, 2000))

    // Step 2: Check if challenge appeared
    const hasChallenge = await webContents.executeJavaScript(
      `!!document.querySelector('iframe[src*="recaptcha/api2/bframe"]')`
    )

    if (!hasChallenge) {
      return { success: true, message: 'reCAPTCHA passed (checkbox only)' }
    }

    // Step 3: Try to click audio button in the challenge iframe via CDP
    const audioClicked = await this.executeInCaptchaFrame(
      webContents,
      'recaptcha/api2/bframe',
      `(function() {
        var btn = document.querySelector('#recaptcha-audio-button, .rc-button-audio');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not found';
      })()`
    )

    if (audioClicked === 'clicked') {
      await new Promise(r => setTimeout(r, 2000))

      // Step 4: Get the audio URL
      const audioUrl = await this.executeInCaptchaFrame(
        webContents,
        'recaptcha/api2/bframe',
        `(function() {
          var link = document.querySelector('.rc-audiochallenge-tdownload-link, audio source, #audio-source');
          return link ? (link.href || link.src) : null;
        })()`
      )

      if (audioUrl) {
        // Step 5: Transcribe
        const transcript = await this.transcribeAudio(audioUrl)
        if (transcript) {
          // Step 6: Fill in the answer and submit
          const submitted = await this.executeInCaptchaFrame(
            webContents,
            'recaptcha/api2/bframe',
            `(function() {
              var input = document.querySelector('#audio-response');
              if (!input) return 'input not found';
              input.value = ${JSON.stringify(transcript)};
              input.dispatchEvent(new Event('input', {bubbles: true}));
              var btn = document.querySelector('#recaptcha-verify-button');
              if (btn) btn.click();
              return 'submitted';
            })()`
          )
          if (submitted === 'submitted') {
            await new Promise(r => setTimeout(r, 2000))
            return { success: true, message: 'reCAPTCHA solved via audio transcription' }
          }
        }
      }
    }

    // Detach debugger
    try { webContents.debugger.detach() } catch { /* ignore */ }

    return {
      success: false,
      message: 'reCAPTCHA audio challenge failed. Try solveCaptcha action for AI vision-based solving.'
    }
  }

  private async solveHcaptchaAudio(webContents: WebContents): Promise<{ success: boolean; message: string }> {
    // hCaptcha: click container, then try CDP for the challenge iframe
    const clickResult = await webContents.executeJavaScript(`
      (function() {
        var container = document.querySelector('.h-captcha, [data-sitekey]');
        if (container) { container.click(); return { ok: true }; }
        return { error: 'hCaptcha container not found' };
      })()
    `)

    if (clickResult?.error) {
      return { success: false, message: clickResult.error }
    }

    await new Promise(r => setTimeout(r, 2000))

    // Try to find and interact with the hCaptcha challenge iframe via CDP
    const accessibilityClicked = await this.executeInCaptchaFrame(
      webContents,
      'hcaptcha.com',
      `(function() {
        var btn = document.querySelector('[aria-label*="accessibility"], .challenge-interface button');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not found';
      })()`
    )

    // Detach debugger
    try { webContents.debugger.detach() } catch { /* ignore */ }

    if (accessibilityClicked === 'clicked') {
      return { success: false, message: 'hCaptcha accessibility mode activated. May need manual completion.' }
    }

    return {
      success: false,
      message: 'hCaptcha challenge appeared. Try solveCaptcha action for AI vision-based solving.'
    }
  }
}
