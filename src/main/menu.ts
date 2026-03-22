import { Menu, BrowserWindow, app, shell, session, webContents, dialog } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { getSystemCookiesForDomain, extractBaseDomain } from './auth/system-browser-auth'
import type { ExtensionManager } from './extensions/extension-manager'

export function createMenu(getMainWindow: () => BrowserWindow | null, extensionManager?: ExtensionManager | null): void {
  const isMac = process.platform === 'darwin'

  /** Safely send IPC to main window, recreating it if destroyed */
  const sendToWindow = (...args: [string, ...unknown[]]): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(...args)
    }
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Oculo',
            submenu: [
              {
                label: 'About Oculo',
                click: (): void => {
                  sendToWindow(IPC.NAVIGATE_TO, 'oculo://about')
                }
              } as Electron.MenuItemConstructorOptions,
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: (): void => {
                  sendToWindow('open-settings')
                }
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ] as Electron.MenuItemConstructorOptions[]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: (): void => { sendToWindow(IPC.TAB_CREATE) }
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (): void => { sendToWindow('close-active-tab') }
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (): void => { sendToWindow('reopen-closed-tab') }
        },
        { type: 'separator' },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: (): void => { sendToWindow('focus-address-bar') }
        },
        { type: 'separator' },
        {
          label: 'Login in System Browser',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: async (): Promise<void> => {
            // Find active tab's URL directly
            const allWC = webContents.getAllWebContents()
            const win = getMainWindow()
            let activeUrl: string | null = null
            for (const wc of allWC) {
              if (win && wc.id === win.webContents.id) continue
              if (wc.isDestroyed()) continue
              const url = wc.getURL()
              if (url && url.startsWith('http')) {
                activeUrl = url
                if (wc.isFocused()) break
              }
            }
            if (activeUrl) {
              // For auth/session pages, open the site's main login page instead
              // because session-specific URLs (2FA, webauthn) won't work in another browser
              let urlToOpen = activeUrl
              try {
                const parsed = new URL(activeUrl)
                const path = parsed.pathname.toLowerCase()
                if (path.includes('session') || path.includes('two-factor') || path.includes('webauthn') ||
                    path.includes('2fa') || path.includes('oauth') || path.includes('authorize')) {
                  urlToOpen = `${parsed.origin}/login`
                  console.log(`[SystemBrowserAuth] Auth page detected, opening login page instead: ${urlToOpen}`)
                }
              } catch { /* use original URL */ }
              await shell.openExternal(urlToOpen)
              console.log(`[SystemBrowserAuth] Opened in system browser: ${urlToOpen}`)
              sendToWindow('toast', { message: 'Opened in system browser — complete login, then press Cmd+Shift+O', type: 'info' })
            } else {
              console.log('[SystemBrowserAuth] No active web page found')
              sendToWindow('toast', { message: 'No active web page found', type: 'error' })
            }
          }
        },
        {
          label: 'Import Session from Browser',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async (): Promise<void> => {
            const allWC = webContents.getAllWebContents()
            const win = getMainWindow()
            let activeWC: Electron.WebContents | null = null
            for (const wc of allWC) {
              if (win && wc.id === win.webContents.id) continue
              if (wc.isDestroyed()) continue
              const url = wc.getURL()
              if (url && url.startsWith('http')) {
                activeWC = wc
                if (wc.isFocused()) break
              }
            }
            if (!activeWC) {
              sendToWindow('toast', { message: 'No active web page found', type: 'error' })
              return
            }
            const activeUrl = activeWC.getURL()
            const domain = extractBaseDomain(activeUrl)
            console.log(`[SystemBrowserAuth] Importing cookies for: ${domain}`)
            sendToWindow('toast', { message: `Importing cookies for ${domain}...`, type: 'info' })

            const systemCookies = await getSystemCookiesForDomain(domain)
            if (systemCookies.length === 0) {
              sendToWindow('toast', { message: `No cookies found for ${domain}. Complete login in Safari first.`, type: 'error' })
              return
            }

            const oculoSession = session.fromPartition('persist:oculo')
            let imported = 0
            for (const cookie of systemCookies) {
              try {
                const cookieDomain = cookie.domain.replace(/^\./, '')
                const url = `http${cookie.secure ? 's' : ''}://${cookieDomain}${cookie.path || '/'}`
                await oculoSession.cookies.set({
                  url,
                  name: cookie.name,
                  value: cookie.value,
                  domain: cookie.domain,
                  path: cookie.path || '/',
                  secure: cookie.secure,
                  httpOnly: cookie.httpOnly,
                  sameSite: 'lax' as const,
                  expirationDate: cookie.expirationDate
                })
                imported++
              } catch { /* skip individual cookie errors */ }
            }
            console.log(`[SystemBrowserAuth] Imported ${imported}/${systemCookies.length} cookies for ${domain}`)
            activeWC.reload()
            sendToWindow('toast', { message: `Imported ${imported} cookies for ${domain} — page reloaded`, type: 'success' })
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Page',
          accelerator: 'CmdOrCtrl+F',
          click: (): void => { sendToWindow('find-in-page') }
        }
      ]
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: (): void => { sendToWindow('nav-back') }
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: (): void => { sendToWindow('nav-forward') }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          label: 'Page Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: (): void => { sendToWindow('zoom-in') }
        },
        {
          label: 'Page Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: (): void => { sendToWindow('zoom-out') }
        },
        {
          label: 'Reset Page Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: (): void => { sendToWindow('zoom-reset') }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Reader Mode',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (): void => { sendToWindow('reader-mode') }
        },
        {
          label: 'Focus Mode',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: (): void => { sendToWindow('focus-mode') }
        },
        {
          label: 'Translate Page',
          click: (): void => { sendToWindow('translate-page') }
        },
        {
          label: 'Split View',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (): void => { sendToWindow('split-view') }
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'CmdOrCtrl+Option+I',
          click: (): void => { sendToWindow('toggle-page-devtools') }
        },
        {
          label: 'JavaScript Console',
          accelerator: 'CmdOrCtrl+Option+J',
          click: (): void => { sendToWindow('toggle-page-devtools') }
        },
        {
          label: 'View Page Source',
          accelerator: 'CmdOrCtrl+Option+U',
          click: (): void => { sendToWindow('view-page-source') }
        },
        {
          label: 'Inspect Element',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (): void => { sendToWindow('inspect-element') }
        },
        { type: 'separator' },
        {
          label: 'Dock DevTools Left',
          click: (): void => { sendToWindow('toggle-page-devtools-mode', 'left') }
        },
        {
          label: 'Dock DevTools Right',
          click: (): void => { sendToWindow('toggle-page-devtools-mode', 'right') }
        },
        {
          label: 'Dock DevTools Bottom',
          click: (): void => { sendToWindow('toggle-page-devtools-mode', 'bottom') }
        },
        {
          label: 'Undock DevTools',
          click: (): void => { sendToWindow('toggle-page-devtools-mode', 'undocked') }
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Oculo Internal DevTools', accelerator: 'CmdOrCtrl+Option+Shift+I' },
        { type: 'separator' },
        {
          label: 'Toggle AI Chat',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (): void => { sendToWindow('toggle-chat') }
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: (): void => { sendToWindow('command-palette') }
        }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        {
          label: 'Add Bookmark',
          accelerator: 'CmdOrCtrl+D',
          click: (): void => { sendToWindow('add-bookmark') }
        },
        {
          label: 'Toggle Bookmarks Bar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: (): void => { sendToWindow('toggle-bookmarks-bar') }
        }
      ]
    },
    {
      label: 'Extensions',
      submenu: [
        {
          label: 'Manage Extensions',
          click: (): void => {
            sendToWindow(IPC.NAVIGATE_TO, 'oculo://extensions')
          }
        },
        {
          label: 'Open Extensions Folder',
          click: async (): Promise<void> => {
            if (extensionManager) {
              const dir = extensionManager.getExtensionsDir()
              await shell.openPath(dir)
            }
          }
        },
        {
          label: 'Install Extension...',
          click: async (): Promise<void> => {
            const win = getMainWindow()
            if (!extensionManager || !win) return
            try {
              const result = await dialog.showOpenDialog(win, {
                title: 'Select Extension Directory',
                properties: ['openDirectory'],
                message: 'Select the unpacked Chrome extension folder (must contain manifest.json)'
              })
              if (result.canceled || !result.filePaths[0]) return
              await extensionManager.installExtension(result.filePaths[0])
              sendToWindow('toast', { message: 'Extension installed successfully', type: 'success' })
            } catch (err: any) {
              sendToWindow('toast', { message: `Failed to install extension: ${err.message}`, type: 'error' })
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Connect Wallet (via Chrome)',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: async (): Promise<void> => {
            await shell.openExternal('http://127.0.0.1:19517/relay')
            sendToWindow('toast', { message: 'Opening wallet relay in Chrome — connect MetaMask there', type: 'info' })
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Oculo Documentation',
          click: (): void => { shell.openExternal('https://github.com/xidik12/oculo') }
        },
        {
          label: 'Report Issue',
          click: (): void => { shell.openExternal('https://github.com/xidik12/oculo/issues') }
        },
        { type: 'separator' },
        {
          label: 'Setup Guide',
          click: (): void => {
            sendToWindow(IPC.NAVIGATE_TO, 'oculo://guide')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
