import { WebContents } from 'electron'
import { ElementResolver } from '../../engine/resolver'
import { SecurityManager } from '../../security/vault'
import { FormDetector } from '../../engine/form-detector'

const resolver = new ElementResolver()
const formDetector = new FormDetector()

/**
 * Wait for navigation to complete (did-stop-loading) or timeout.
 */
function waitForNavigation(webContents: WebContents, timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false
    const done = () => {
      if (resolved) return
      resolved = true
      webContents.removeListener('did-stop-loading', onStop)
      resolve()
    }
    const onStop = () => done()
    webContents.on('did-stop-loading', onStop)
    setTimeout(done, timeout)
  })
}

/**
 * Execute a single action on the page. Shared by both the `act` MCP tool
 * and the pipeline runner so logic is not duplicated.
 */
export async function executeAction(
  webContents: WebContents,
  args: any,
  security?: SecurityManager
): Promise<string> {
  const action = args.action

  switch (action) {
    case 'navigate':
      if (!args.url) return 'No URL specified'
      await webContents.loadURL(args.url)
      await waitForNavigation(webContents)
      const title = await webContents.executeJavaScript('document.title')
      return `Navigated to ${title} | ${args.url}`

    case 'back':
      if (!webContents.canGoBack()) return 'Cannot go back'
      webContents.goBack()
      await waitForNavigation(webContents)
      return `Went back to ${webContents.getURL()}`

    case 'forward':
      if (!webContents.canGoForward()) return 'Cannot go forward'
      webContents.goForward()
      await waitForNavigation(webContents)
      return `Went forward to ${webContents.getURL()}`

    case 'reload':
      webContents.reload()
      await waitForNavigation(webContents)
      return `Reloaded ${webContents.getURL()}`

    case 'click':
      return await resolver.click(webContents, args)

    case 'hover': {
      const resolved = await resolver.resolve(webContents, args)
      if (!resolved.found) return resolved.error || 'Element not found'
      await webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(resolved.selector)})?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`
      )
      return `Hovered over "${args.text || args.selector}"`
    }

    case 'scroll': {
      const dir = args.direction || 'down'
      const amt = args.amount || 500
      const scrollMap: Record<string, string> = {
        down: `window.scrollBy(0,${amt})`, up: `window.scrollBy(0,-${amt})`,
        left: `window.scrollBy(-${amt},0)`, right: `window.scrollBy(${amt},0)`
      }
      await webContents.executeJavaScript(scrollMap[dir] || scrollMap.down)
      return `Scrolled ${dir} ${amt}px`
    }

    case 'press':
      if (!args.key) return 'No key specified'
      await webContents.sendInputEvent({ type: 'keyDown', keyCode: args.key } as any)
      await new Promise(r => setTimeout(r, 50))
      await webContents.sendInputEvent({ type: 'keyUp', keyCode: args.key } as any)
      return `Pressed ${args.key}`

    case 'select':
      if (!args.value) return 'No value specified for select'
      return await resolver.select(webContents, args, args.value)

    case 'login': {
      if (!args.site) return 'No site specified for login'
      if (!security) return 'Security manager not available for login'
      const cred = security.getCredential(args.site)
      if (!cred) return `No credentials found for "${args.site}". Add them via Oculo Settings > Passwords.`

      // Detect login form and fill
      await formDetector.fillForm(webContents, {
        ...(cred.username.includes('@')
          ? { 'Email': cred.username, 'email': cred.username }
          : { 'Username': cred.username, 'username': cred.username, 'User': cred.username }),
        'Password': cred.password,
        'password': cred.password
      }, true)

      await waitForNavigation(webContents)
      const pageTitle = await webContents.executeJavaScript('document.title')
      return `Logged in to ${args.site} as ${cred.username}. Page: ${pageTitle} | ${webContents.getURL()}`
    }

    default:
      // Handle type action (when text + target are provided but action isn't explicitly "type")
      if (args.text && (args.label || args.placeholder || args.selector || args.role)) {
        return await resolver.type(webContents, args, args.text, args.clear)
      }
      return `Unknown action: ${action}`
  }
}

/**
 * MCP tool handler — delegates to executeAction.
 */
export async function handleActTool(
  webContents: WebContents,
  args: any,
  security: SecurityManager
): Promise<string> {
  return executeAction(webContents, args, security)
}
