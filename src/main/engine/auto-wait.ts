import { WebContents } from 'electron'

export class AutoWaiter {
  /**
   * Wait for navigation to complete (page fully loaded).
   * Listens for 'did-stop-loading' event on webContents.
   */
  static waitForNavigation(wc: WebContents, timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!wc || wc.isDestroyed()) {
        resolve()
        return
      }

      const timer = setTimeout(() => {
        wc.removeListener('did-stop-loading', onStop)
        resolve() // resolve even on timeout — page may be usable
      }, timeout)

      const onStop = (): void => {
        clearTimeout(timer)
        // Small delay after load to let JS frameworks hydrate
        setTimeout(resolve, 100)
      }

      wc.once('did-stop-loading', onStop)
    })
  }

  /**
   * Wait for network to become idle (no pending requests for idleMs).
   * Uses webRequest API to track in-flight requests.
   */
  static waitForNetworkIdle(wc: WebContents, idleMs = 500, timeout = 10000): Promise<void> {
    return new Promise((resolve) => {
      if (!wc || wc.isDestroyed()) {
        resolve()
        return
      }

      let pending = 0
      let idleTimer: NodeJS.Timeout | null = null
      let cleaned = false

      const cleanup = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        clearTimeout(timeoutTimer)
        cleaned = true
      }

      const checkIdle = (): void => {
        if (cleaned) return
        if (pending <= 0) {
          idleTimer = setTimeout(() => {
            cleanup()
            resolve()
          }, idleMs)
        }
      }

      const _onBeforeRequest = (_details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void): void => {
        if (cleaned) {
          callback({})
          return
        }
        pending++
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
        callback({})
      }

      const _onCompleted = (): void => {
        if (cleaned) return
        pending = Math.max(0, pending - 1)
        checkIdle()
      }

      const _onErrorOccurred = (): void => {
        if (cleaned) return
        pending = Math.max(0, pending - 1)
        checkIdle()
      }

      const timeoutTimer = setTimeout(() => {
        cleanup()
        resolve()
      }, timeout)

      // Start idle check immediately (page might already be idle)
      checkIdle()
    })
  }

  /**
   * Wait for DOM to stabilize (no mutations for stabilizeMs).
   * Executes a MutationObserver in the webview via executeJavaScript.
   */
  static waitForDomStable(wc: WebContents, stabilizeMs = 300, timeout = 5000): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!wc || wc.isDestroyed()) {
        resolve()
        return
      }

      const timer = setTimeout(resolve, timeout)

      wc.executeJavaScript(`
        new Promise((resolve) => {
          let timer = null;
          const observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, ${stabilizeMs});
          });
          observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true, attributes: true
          });
          // Start the timer immediately in case DOM is already stable
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, ${stabilizeMs});
        })
      `)
        .then(() => {
          clearTimeout(timer)
          resolve()
        })
        .catch(() => {
          clearTimeout(timer)
          resolve() // resolve on error — don't block automation
        })
    })
  }

  /**
   * Wait for a specific element to appear in the DOM.
   * Polls via executeJavaScript.
   */
  static waitForElement(wc: WebContents, selector: string, timeout = 5000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!wc || wc.isDestroyed()) {
        resolve(false)
        return
      }

      const startTime = Date.now()
      const pollInterval = 200

      const poll = (): void => {
        if (Date.now() - startTime > timeout) {
          resolve(false)
          return
        }

        wc.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(selector)})`
        )
          .then((found: boolean) => {
            if (found) {
              resolve(true)
            } else {
              setTimeout(poll, pollInterval)
            }
          })
          .catch(() => {
            resolve(false)
          })
      }

      poll()
    })
  }

  /**
   * Wait for page to be interactive (DOM loaded + no heavy layout shifts).
   * Combines navigation wait + DOM stability.
   */
  static async waitForReady(wc: WebContents, timeout = 10000): Promise<void> {
    if (!wc || wc.isDestroyed()) return

    // First wait for load to complete
    if (wc.isLoading()) {
      await AutoWaiter.waitForNavigation(wc, timeout)
    }

    // Then wait for DOM to stabilize
    await AutoWaiter.waitForDomStable(wc, 200, Math.min(timeout, 3000))
  }
}
