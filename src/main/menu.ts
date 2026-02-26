import { Menu, BrowserWindow, app, shell } from 'electron'
import { IPC } from '../shared/ipc-channels'

export function createMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Oculo',
            submenu: [
              {
                label: 'About Oculo',
                click: (): void => {
                  mainWindow.webContents.send(IPC.NAVIGATE_TO, 'oculo://about')
                }
              } as Electron.MenuItemConstructorOptions,
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: (): void => {
                  mainWindow.webContents.send('open-settings')
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
          click: (): void => { mainWindow.webContents.send(IPC.TAB_CREATE) }
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (): void => { mainWindow.webContents.send('close-active-tab') }
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (): void => { mainWindow.webContents.send('reopen-closed-tab') }
        },
        { type: 'separator' },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: (): void => { mainWindow.webContents.send('focus-address-bar') }
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
          click: (): void => { mainWindow.webContents.send('find-in-page') }
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
          click: (): void => { mainWindow.webContents.send('zoom-in') }
        },
        {
          label: 'Page Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: (): void => { mainWindow.webContents.send('zoom-out') }
        },
        {
          label: 'Reset Page Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: (): void => { mainWindow.webContents.send('zoom-reset') }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Reader Mode',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (): void => { mainWindow.webContents.send('reader-mode') }
        },
        {
          label: 'Split View',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (): void => { mainWindow.webContents.send('split-view') }
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'CmdOrCtrl+Option+I',
          click: (): void => { mainWindow.webContents.send('toggle-page-devtools') }
        },
        {
          label: 'JavaScript Console',
          accelerator: 'CmdOrCtrl+Option+J',
          click: (): void => { mainWindow.webContents.send('toggle-page-devtools') }
        },
        {
          label: 'View Page Source',
          accelerator: 'CmdOrCtrl+Option+U',
          click: (): void => { mainWindow.webContents.send('view-page-source') }
        },
        {
          label: 'Inspect Element',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (): void => { mainWindow.webContents.send('inspect-element') }
        },
        { type: 'separator' },
        {
          label: 'Dock DevTools Left',
          click: (): void => { mainWindow.webContents.send('toggle-page-devtools-mode', 'left') }
        },
        {
          label: 'Dock DevTools Right',
          click: (): void => { mainWindow.webContents.send('toggle-page-devtools-mode', 'right') }
        },
        {
          label: 'Dock DevTools Bottom',
          click: (): void => { mainWindow.webContents.send('toggle-page-devtools-mode', 'bottom') }
        },
        {
          label: 'Undock DevTools',
          click: (): void => { mainWindow.webContents.send('toggle-page-devtools-mode', 'undocked') }
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Oculo Internal DevTools', accelerator: 'CmdOrCtrl+Option+Shift+I' },
        { type: 'separator' },
        {
          label: 'Toggle AI Chat',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (): void => { mainWindow.webContents.send('toggle-chat') }
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: (): void => { mainWindow.webContents.send('command-palette') }
        }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        {
          label: 'Add Bookmark',
          accelerator: 'CmdOrCtrl+D',
          click: (): void => { mainWindow.webContents.send('add-bookmark') }
        },
        {
          label: 'Toggle Bookmarks Bar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: (): void => { mainWindow.webContents.send('toggle-bookmarks-bar') }
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
          click: (): void => { shell.openExternal('https://github.com/xidik12/oculo-mcp') }
        },
        {
          label: 'Report Issue',
          click: (): void => { shell.openExternal('https://github.com/xidik12/oculo-mcp/issues') }
        },
        { type: 'separator' },
        {
          label: 'Setup Guide',
          click: (): void => {
            mainWindow.webContents.send(IPC.NAVIGATE_TO, 'oculo://guide')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
