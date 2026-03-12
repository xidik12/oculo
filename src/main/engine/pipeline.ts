import { WebContents, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { PipelineStep } from '../../shared/types'
import { PageDescriber } from './describer'
import { FormDetector } from './form-detector'
import { DataExtractor } from './extractor'
import { executeAction } from '../mcp/tools/act'

export class PipelineRunner {
  private describer: PageDescriber
  private formDetector: FormDetector
  private extractor: DataExtractor

  constructor() {
    this.describer = new PageDescriber()
    this.formDetector = new FormDetector()
    this.extractor = new DataExtractor()
  }

  async run(
    webContents: WebContents,
    steps: PipelineStep[],
    returnAll?: boolean
  ): Promise<string> {
    const results: string[] = []

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]

      try {
        let result = ''

        if (step.page) {
          result = await this.describer.describe(webContents, step.page)
        } else if (step.act) {
          if (step.act.action === 'screenshot' as any) {
            result = await this.captureScreenshot(webContents)
          } else {
            result = await executeAction(webContents, step.act)
          }
        } else if (step.fill) {
          result = await this.formDetector.fillForm(
            webContents,
            step.fill.fields,
            step.fill.submit
          )
        } else if (step.read) {
          result = await this.extractor.extract(
            webContents,
            step.read.what,
            step.read
          )
        } else if (step.wait) {
          result = await this.executeWait(webContents, step.wait)
        } else if (step.if) {
          result = await this.executeConditional(webContents, step.if)
        }

        if (returnAll) {
          const stepType = step.page ? 'page' : step.act ? `act:${(step.act as any).action}` : step.fill ? 'fill' : step.read ? 'read' : step.wait ? 'wait' : step.if ? 'if' : 'unknown'
          results.push(`[step ${i + 1}: ${stepType}]\n${result}`)
        } else {
          results.push(result)
        }
      } catch (err) {
        const errMsg = (err as Error).message
        const partial = results.length > 0 ? '\n' + results.join('\n') : ''
        return `Pipeline stopped at step ${i + 1}/${steps.length}: ${errMsg}${partial}`
      }
    }

    const url = webContents.getURL()
    const title = await webContents.executeJavaScript('document.title')
    const header = `Pipeline ${steps.length}/${steps.length} OK\n[${title} | ${url}]`

    if (returnAll) {
      return header + '\n\n' + results.join('\n---\n')
    }

    // Return header + last result
    const lastResult = results[results.length - 1] || ''
    return header + '\n\n' + lastResult
  }

  private async captureScreenshot(webContents: WebContents): Promise<string> {
    try {
      const nativeImage = await webContents.capturePage()
      const buffer = nativeImage.toPNG()
      const dir = path.join(app.getPath('pictures'), 'Oculo')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, `screenshot-${Date.now()}.png`)
      fs.writeFileSync(filePath, buffer)
      return `Screenshot saved: ${filePath}`
    } catch (e: any) {
      return `Error capturing screenshot: ${e.message}`
    }
  }

  private async executeWait(webContents: WebContents, wait: any): Promise<string> {
    const timeout = wait.timeout || 5000
    const start = Date.now()

    while (Date.now() - start < timeout) {
      if (wait.text) {
        const hasText = await webContents.executeJavaScript(
          `document.body.textContent.toLowerCase().includes(${JSON.stringify(wait.text.toLowerCase())})`
        )
        if (hasText) return `Found text '${wait.text}' after ${Date.now() - start}ms`
      }
      if (wait.url) {
        const currentUrl = webContents.getURL()
        if (currentUrl.includes(wait.url)) return `URL matched "${wait.url}" after ${Date.now() - start}ms`
      }
      if (wait.selector) {
        const hasEl = await webContents.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(wait.selector)})`
        )
        if (hasEl) return `Element "${wait.selector}" found after ${Date.now() - start}ms`
      }
      await new Promise(r => setTimeout(r, 250))
    }

    if (wait.text) {
      return `Timed out after ${timeout}ms — text '${wait.text}' not found on page`
    }
    const target = wait.url ? `url "${wait.url}"` : wait.selector ? `selector "${wait.selector}"` : 'condition'
    return `Timed out after ${timeout}ms — ${target} not found on page`
  }

  private async executeConditional(webContents: WebContents, cond: any): Promise<string> {
    let conditionMet = false

    if (cond.text) {
      conditionMet = await webContents.executeJavaScript(
        `document.body.textContent.toLowerCase().includes(${JSON.stringify(cond.text.toLowerCase())})`
      )
    } else if (cond.url) {
      conditionMet = webContents.getURL().includes(cond.url)
    }

    const branch = conditionMet ? cond.then : cond.else
    if (branch) {
      return await this.run(webContents, [branch], false)
    }
    return `Condition ${conditionMet ? 'met' : 'not met'}, no branch to execute`
  }
}
