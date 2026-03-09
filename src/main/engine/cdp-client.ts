import { WebContents } from 'electron'

/**
 * CDP Client — wrapper around Electron's webContents.debugger API.
 * Provides direct access to Chrome DevTools Protocol for more reliable
 * browser automation (bypasses JS execution context issues).
 */
export class CdpClient {
  private attached = new Set<number>()

  /** Attach debugger to a webContents */
  async attach(wc: WebContents): Promise<boolean> {
    if (!wc || wc.isDestroyed()) return false
    const id = wc.id
    if (this.attached.has(id)) return true

    try {
      wc.debugger.attach('1.3')
      this.attached.add(id)

      // Clean up on destruction
      wc.once('destroyed', () => {
        this.attached.delete(id)
      })

      // Enable required domains
      await wc.debugger.sendCommand('DOM.enable')
      await wc.debugger.sendCommand('Runtime.enable')

      return true
    } catch (err) {
      console.error('[CDP] Attach failed:', err)
      return false
    }
  }

  /** Detach debugger from a webContents */
  detach(wc: WebContents): void {
    if (!wc || wc.isDestroyed()) return
    try {
      if (this.attached.has(wc.id)) {
        wc.debugger.detach()
        this.attached.delete(wc.id)
      }
    } catch {
      /* already detached */
    }
  }

  /** Check if debugger is attached */
  isAttached(wc: WebContents): boolean {
    return this.attached.has(wc.id)
  }

  /** Dispatch a mouse click at coordinates via CDP Input.dispatchMouseEvent */
  async dispatchClick(
    wc: WebContents,
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }
  ): Promise<void> {
    if (!this.ensureAttached(wc)) return

    const button = options?.button || 'left'
    const clickCount = options?.clickCount || 1

    try {
      // Mouse down
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        clickCount,
        buttons: 1
      })

      // Small delay for human-like behavior
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 30))

      // Mouse up
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        clickCount,
        buttons: 0
      })
    } catch (err) {
      console.error('[CDP] Click failed:', err)
    }
  }

  /** Dispatch keyboard input via CDP Input.dispatchKeyEvent */
  async dispatchKeyboard(wc: WebContents, text: string): Promise<void> {
    if (!this.ensureAttached(wc)) return

    try {
      for (const char of text) {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
          key: char,
          unmodifiedText: char
        })

        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'char',
          text: char,
          key: char,
          unmodifiedText: char
        })

        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: char
        })

        // Human-like typing delay
        await new Promise((r) => setTimeout(r, 30 + Math.random() * 50))
      }
    } catch (err) {
      console.error('[CDP] Keyboard input failed:', err)
    }
  }

  /** Press a special key (Enter, Tab, Escape, etc.) */
  async pressKey(
    wc: WebContents,
    key: string,
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  ): Promise<void> {
    if (!this.ensureAttached(wc)) return

    // Map key names to key codes
    const keyMap: Record<string, { keyCode: number; code: string }> = {
      Enter: { keyCode: 13, code: 'Enter' },
      Tab: { keyCode: 9, code: 'Tab' },
      Escape: { keyCode: 27, code: 'Escape' },
      Backspace: { keyCode: 8, code: 'Backspace' },
      Delete: { keyCode: 46, code: 'Delete' },
      ArrowUp: { keyCode: 38, code: 'ArrowUp' },
      ArrowDown: { keyCode: 40, code: 'ArrowDown' },
      ArrowLeft: { keyCode: 37, code: 'ArrowLeft' },
      ArrowRight: { keyCode: 39, code: 'ArrowRight' },
      Home: { keyCode: 36, code: 'Home' },
      End: { keyCode: 35, code: 'End' },
      PageUp: { keyCode: 33, code: 'PageUp' },
      PageDown: { keyCode: 34, code: 'PageDown' },
      Space: { keyCode: 32, code: 'Space' }
    }

    const mapped = keyMap[key] || { keyCode: key.charCodeAt(0), code: key }
    let modifierFlags = 0
    if (modifiers?.alt) modifierFlags |= 1
    if (modifiers?.ctrl) modifierFlags |= 2
    if (modifiers?.meta) modifierFlags |= 4
    if (modifiers?.shift) modifierFlags |= 8

    try {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        nativeVirtualKeyCode: mapped.keyCode,
        modifiers: modifierFlags
      })

      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        nativeVirtualKeyCode: mapped.keyCode,
        modifiers: modifierFlags
      })
    } catch (err) {
      console.error('[CDP] Key press failed:', err)
    }
  }

  /** Get the full accessibility tree via CDP */
  async getAccessibilityTree(wc: WebContents): Promise<any> {
    if (!this.ensureAttached(wc)) return null

    try {
      await wc.debugger.sendCommand('Accessibility.enable')
      const result = await wc.debugger.sendCommand('Accessibility.getFullAXTree')
      return result
    } catch (err) {
      console.error('[CDP] Accessibility tree failed:', err)
      return null
    }
  }

  /** Query a DOM element via CDP */
  async querySelector(
    wc: WebContents,
    selector: string
  ): Promise<{ nodeId: number; x: number; y: number; width: number; height: number } | null> {
    if (!this.ensureAttached(wc)) return null

    try {
      const doc = await wc.debugger.sendCommand('DOM.getDocument')
      const result = await wc.debugger.sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector
      })

      if (!result.nodeId) return null

      // Get element box model for coordinates
      try {
        const boxModel = await wc.debugger.sendCommand('DOM.getBoxModel', {
          nodeId: result.nodeId
        })

        const content = boxModel.model.content
        // content is [x1,y1, x2,y2, x3,y3, x4,y4] (quad)
        const x = (content[0] + content[2]) / 2
        const y = (content[1] + content[5]) / 2
        const width = content[2] - content[0]
        const height = content[5] - content[1]

        return { nodeId: result.nodeId, x, y, width, height }
      } catch {
        return { nodeId: result.nodeId, x: 0, y: 0, width: 0, height: 0 }
      }
    } catch (err) {
      console.error('[CDP] querySelector failed:', err)
      return null
    }
  }

  /** Evaluate JavaScript expression via CDP Runtime */
  async evaluate(wc: WebContents, expression: string): Promise<any> {
    if (!this.ensureAttached(wc)) return null

    try {
      const result = await wc.debugger.sendCommand('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      })

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Evaluation failed')
      }

      return result.result?.value
    } catch (err) {
      console.error('[CDP] Evaluate failed:', err)
      return null
    }
  }

  /** Take a high-quality screenshot via CDP */
  async captureScreenshot(
    wc: WebContents,
    options?: { format?: 'jpeg' | 'png'; quality?: number }
  ): Promise<string | null> {
    if (!this.ensureAttached(wc)) return null

    try {
      const result = await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: options?.format || 'png',
        quality: options?.quality || 80,
        fromSurface: true
      })
      return result.data // base64-encoded
    } catch (err) {
      console.error('[CDP] Screenshot failed:', err)
      return null
    }
  }

  private ensureAttached(wc: WebContents): boolean {
    if (!wc || wc.isDestroyed()) return false
    if (!this.attached.has(wc.id)) {
      console.warn('[CDP] Not attached to webContents', wc.id)
      return false
    }
    return true
  }
}
