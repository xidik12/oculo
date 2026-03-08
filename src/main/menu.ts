import { Menu, BrowserWindow, app, shell } from 'electron'
import { IPC } from '../shared/ipc-channels'

export function createMenu(getMainWindow: () => BrowserWindow | null): void {
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
