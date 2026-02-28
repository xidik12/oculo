import { BrowserWindow, dialog, Notification } from 'electron'
import { PERMISSION_MAP } from '../../shared/constants'
import { PermissionLevel } from '../../shared/types'
import { AuditLog } from './audit'

export class PermissionGate {
  private mainWindow: BrowserWindow
  private auditLog: AuditLog

  constructor(mainWindow: BrowserWindow, auditLog: AuditLog) {
    this.mainWindow = mainWindow
    this.auditLog = auditLog
  }

  /**
   * Check if an action is allowed.
   * Returns true if allowed, false if denied.
   */
  async check(action: string, details: string): Promise<boolean> {
    const level = this.getPermissionLevel(action)

    switch (level) {
      case 'auto':
        return true

      case 'notify':
        this.notify(action, details)
        return true

      case 'confirm':
        return await this.confirm(action, details)

      case 'blocked':
        this.auditLog.log(action, details, 'blocked')
        return false

      default:
        return true
    }
  }

  private getPermissionLevel(action: string): PermissionLevel {
    // Check exact match first
    if (action in PERMISSION_MAP) {
      return PERMISSION_MAP[action]
    }
    
    // Check if action contains a known keyword (longest match first to prevent
    // "read" matching before "read_vault", which would bypass security)
    const actionLower = action.toLowerCase()
    const entries = Object.entries(PERMISSION_MAP).sort((a, b) => b[0].length - a[0].length)
    for (const [key, level] of entries) {
      if (actionLower.includes(key)) {
        return level
      }
    }

    // Default to notify for unknown actions
    return 'notify'
  }

  private notify(action: string, details: string): void {
    // Skip OS notifications — actions are visible in the chat panel's tool call UI
    this.auditLog.log(action, details, 'success')
  }

  private async confirm(action: string, details: string): Promise<boolean> {
    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'question',
      title: 'Oculo: Confirm Action',
      message: `Claude wants to perform: ${action}`,
      detail: details.substring(0, 300),
      buttons: ['Allow', 'Deny'],
      defaultId: 1,
      cancelId: 1
    })

    const approved = result.response === 0
    this.auditLog.log(action, details, approved ? 'confirmed' : 'denied')
    return approved
  }
}
